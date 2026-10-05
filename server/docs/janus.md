# Janus AudioBridge (audio MCU)

Janus is the **audio half** of the meeting media plane: a self-hosted WebRTC gateway running the **AudioBridge plugin** as an **MCU (mixing unit)** — every participant's microphone Opus stream is decoded server-side, mixed into one stream, and sent back as a single feed per participant. The video half is LiveKit (SFU) and NAT traversal for both PeerConnections is coturn; why the plane is split this way lives in `docs/meeting-media-architecture.md` §2–§3. Spring Boot is the **control plane**: it creates and destroys rooms, enforces moderation (mute, kick) at the bridge, and hands admitted browsers their per-room credentials — browsers never call the HTTP API. Implementation status: the Spring side is complete and smoke-tested; the browser WebSocket client is pending (`docs/implementation-status.md` §1).

Room keying, stated once because it is deliberately asymmetric with the video plane: **AudioBridge room id = numeric `meetings.id`** (LiveKit's room name is the `join_code`), and every browser joins with **`id = users.id`**, so admin operations target users by id with no feeder lookup (`docs/meeting-media-architecture.md` §4.2).

## 1. How the audio stream is transferred

```
  browser A ── mic Opus ~32 kbps ──►┐
  browser B ── mic Opus ~32 kbps ──►│  Janus AudioBridge, room = meetings.id
  browser C ── mic Opus ~32 kbps ──►┘  N × decode → one mix → 1 × encode per participant
     ▲           ▲           ▲
     └───────────┴───────────┘   each browser receives exactly ONE mixed stream back
```

- **Transport is plain WebRTC per browser**: one PeerConnection dedicated to audio (camera/screen ride a *separate* PeerConnection to LiveKit) — ICE → DTLS → SRTP. coturn (`:3478`, STUN/TURN) is the shared relay fallback for symmetric-NAT clients; the container reserves UDP `51000-51100` (§2.3).
- **Why mix instead of forward**: at ~32 kbps per Opus feed, an audio SFU would hand each participant N−1 separate streams (N decoders and N audio elements per browser), while the MCU returns one mix whose downlink is **O(1) in room size** — a 30-person meeting moves ≈1 Mbps each way. Capacity math: `docs/meeting-media-architecture.md` §8.
- The mix is a **full mix** — whether a participant hears their own voice is the pending *mix-minus spike* (`docs/implementation-status.md` §1); browser AEC mitigates either way.
- `events = true` makes AudioBridge emit **`talking` notifications** — the designated native speaking source once the browser client lands (today's speaking indicator is client-local mic analysis → `PATCH /meetings/{joinCode}/participants/me/speaking`).
- **Video never touches Janus** — no camera or screen bytes flow through this container.

## 2. Deployment & configuration

### 2.1 Container

```yaml
janus:
  build:
    context: ./docker/janus
  image: myrooms-janus:1.4.2
  container_name: myrooms-janus
  restart: always
  ports:
    - "8188:8188/tcp"
    - "8088:8088/tcp"
    - "51000-51100:51000-51100/udp"
  volumes:
    - ./docker/janus/etc/janus.d/janus.plugin.audiobridge.jcfg:/opt/janus/etc/janus/janus.plugin.audiobridge.jcfg:ro
    - ./docker/janus/etc/janus.d/janus.transport.websockets.jcfg:/opt/janus/etc/janus/janus.transport.websockets.jcfg:ro
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:8088/janus/info >/dev/null || exit 1"]
```

| Port | Protocol | Who talks to it | Purpose |
|---|---|---|---|
| 8188 | tcp (WebSocket) | browsers | AudioBridge signaling — the `app.janus.ws-url` handed out in media credentials |
| 8088 | tcp (HTTP) | Spring only | the control/admin API — `app.janus.http-url`. **Not** 8083 (the Spring app) — the two are visually confusable |
| 51000–51100 | udp | media plane | RTP range; must equal `rtp_port_range` in the AudioBridge jcfg (§2.3) |

On Linux also add `extra_hosts: ["host.docker.internal:host-gateway"]` (already noted in the compose file). First `docker compose up` builds the image from source, ~5 min.

### 2.2 Why the image is built from source

`docker/janus/Dockerfile` builds **janus-gateway v1.4.2 from the release tarball** on ubuntu:24.04 — there is no official Meetecho image and the community ones are stale or untagged. Compiled in: the **WebSocket transport** (8188), the **HTTP transport** (8088), and the **AudioBridge plugin**; `make configs` installs the sample jcfg files that the two overrides below replace whole-file. `--enable-post-processing` was deliberately dropped (it pulls ffmpeg dev libs; only needed for recording conversion) — `docs/implementation-status.md` §3.

### 2.3 The two jcfg overrides

`docker/janus/etc/janus.d/janus.plugin.audiobridge.jcfg` — the plugin config:

```text
general: {
    admin_key = "devjanusadminkey"
    /* Must match the published UDP range in docker-compose.yml */
    rtp_port_range = "51000-51100"
    /* talking events — feeds the future active-speaker UI */
    events = true
}
```

- `admin_key` gates room creation — **must equal `app.janus.admin-key`** in `application.properties`.
- No static rooms are declared: every room is created through the API at meeting start with per-room secret/pin (§3).

`docker/janus/etc/janus.d/janus.transport.websockets.jcfg` — the browser-facing transport:

```text
general: {
    json = "compact"
    ws = true
    ws_port = 8188
    wss = false
}
cors: {
    allow_origin = "http://localhost:4200"
    enforce_cors = false
}
```

`allow_origin` mirrors `app.client.url` (the Spring CORS origin). `enforce_cors = false` is deliberate and temporary — tighten it after the browser client spike (`docs/implementation-status.md` §2).

### 2.4 Spring properties

```properties
app.janus.http-url=http://localhost:8088/janus
app.janus.ws-url=ws://localhost:8188
app.janus.admin-key=devjanusadminkey
app.janus.room-secret-pepper=devjanuspepper-5e1b9c4a7f2d8036b5e4
app.janus.sampling-rate=48000
```

Bound by `configuration/JanusProperties` (registered in `configuration/MediaConfiguration`):

| Property | Meaning |
|---|---|
| `http-url` | the Spring control channel — the HTTP transport's admin API |
| `ws-url` | what browsers receive in their media credentials (`MediaCredentialsDTO.janusWsUrl`) |
| `admin-key` | room-creation gate; **must equal** jcfg `admin_key` |
| `room-secret-pepper` | seeds the deterministic per-room secret/pin derivation (§3) |
| `sampling-rate` | the mix's sample rate, sent on every `create` (48000 Hz) |

Two values must stay in sync by hand — nothing validates them:

| `application.properties` / compose | must match | where Janus reads it |
|---|---|---|
| `app.janus.admin-key` | `admin_key` | `janus.plugin.audiobridge.jcfg` |
| compose `ports: 51000-51100/udp` | `rtp_port_range` | `janus.plugin.audiobridge.jcfg` |

## 3. Room security model — `admin_key` vs secret vs pin

| Credential | Format | Known by | Gates |
|---|---|---|---|
| `admin_key` | static string | jcfg + Spring (`app.janus.admin-key`) | room **creation** |
| room `secret` | 24 hex chars, per room | **Spring only** — never sent to a client | per-room **admin ops**: `mute`/`unmute`, `kick`, `destroy` |
| room `pin` | 8 hex chars, per room | Spring + **admitted clients** | **joining** the room |

`services/media/RoomSecretDeriver` derives both from the configured pepper — deterministic HMAC, no stored state, no schema:

```text
secret(meetingId) = hex(HMAC-SHA256(pepper, "admin:" + meetingId))[0..24]
pin(meetingId)    = hex(HMAC-SHA256(pepper, "pin:"    + meetingId))[0..8]
```

- The different prefixes (`"admin:"` vs `"pin:"`) mean neither can be derived from the other.
- **The secret never reaches a client**: a joiner presenting the secret is treated as a room admin — an unmuteable participant — so only the pin is handed out (in `MediaCredentialsDTO`).
- Determinism is the point: credentials survive restarts of both Spring and Janus without persisting anything. Every admin request Spring sends carries both `admin_key` and the room `secret` (the client puts both in `adminBody`).
- **Rotating the pepper invalidates every existing room's credentials** — Janus keeps the old room (created with the old secret) while Spring derives the new one, so admin ops start failing authorization until the room is recreated (restart Janus or let `destroyRoom` run at meeting end). Rotate between meetings, not during.
- Behavior is unit-tested in `src/test/java/.../services/media/RoomSecretDeriverTest.java` (determinism, lengths, cross-meeting and cross-pepper divergence).

## 4. Spring control-plane usage

### 4.1 The classes

| Class | Role |
|---|---|
| `configuration/JanusProperties` | the `app.janus.*` record |
| `services/media/JanusAudioBridgeClient` | the admin surface — every AudioBridge request; **never throws** (logs WARN, returns `false`) |
| `services/media/JanusHttpTransport` | the one-method POST seam; an interface only so unit tests stub it instead of a real HTTP server |
| `services/media/JanusRestHttpTransport` | the impl — Spring `RestClient` on `app.janus.http-url`; no tuned timeouts, transport failures surface as `RestClientException` inside the client's catch-all |
| `services/media/RoomSecretDeriver` | per-room secret/pin (§3) |
| `services/media/MediaTokenService` | composes both planes' credentials for a JOINED participant; its lazy `ensureRoom` is the self-heal path |

### 4.2 Operations and their callers

| Client method | AudioBridge request(s) | Expected status | Called from |
|---|---|---|---|
| `ensureRoom(meetingId)` | `exists` → `create` (skipped when it exists) | `created` | `MeetingService.create` (INSTANT) and `start`; **lazily on every `MediaTokenService.mintFor`** — the self-heal |
| `destroyRoom(meetingId)` | `destroy` | `destroyed` | `MeetingService.end` (after the rule-4 tx and LiveKit `deleteRoom`) |
| `adminMute(meetingId, userId, mute)` | `mute` / `unmute` | `success` | `MeetingParticipantService.muteParticipant` — deliberately **before** the DB write (§4.4) |
| `kick(meetingId, userId)` | `kick` | `success` | `MeetingParticipantService.removeParticipant` (after the DB tx and LiveKit removal) |
| `roomExists(meetingId)` | `exists` | — (`exists` flag) | internal guard inside `ensureRoom` |

Flows with **no** Janus call: admit (the admitted client picks up credentials on its next `/me` poll, which re-ensures the room), leave (the browser simply closes/leaves), self-mute (client-side `configure`, §5), lock (a pure DB flag — the token gate enforces it), and everything video (LiveKit's domain).

### 4.3 One ephemeral session per operation

Every operation runs its own short-lived HTTP session — three sequential round trips plus an always-issued destroy — keeping the client stateless (Janus reaps idle sessions after 60 s anyway):

```text
1. POST http://localhost:8088/janus
   {"janus":"create","transaction":"<uuid>"}
   → {"janus":"success","data":{"id":76543}}

2. POST http://localhost:8088/janus/76543
   {"janus":"attach","plugin":"janus.plugin.audiobridge","transaction":"<uuid>"}
   → {"janus":"success","data":{"id":39577123}}

3. POST http://localhost:8088/janus/76543/39577123
   {"janus":"message","transaction":"<uuid>","body":{ …the AudioBridge request… }}
   → {"janus":"success","plugindata":{"plugin":"janus.plugin.audiobridge",
                                      "data":{"audiobridge":"<status word>"}}}

4. POST http://localhost:8088/janus/76543
   {"janus":"destroy","transaction":"<uuid>"}      ← in a finally; failure is harmless (60 s timeout reaps)
```

The `create` body `ensureRoom` sends (other admin bodies carry `request`, `secret`, `admin_key`, `room` and — for `mute`/`kick` — the target `id = users.id`):

```json
{
  "request": "create",
  "room": 42,
  "pin": "a1b2c3d4",
  "secret": "<24-hex room secret>",
  "admin_key": "devjanusadminkey",
  "sampling_rate": 48000,
  "description": "meeting-42",
  "permanent": false
}
```

Every synchronous answer comes back on the POST response (an `"ack"` would mean an async plugin answer — none of the ops used here are async). Success is checked twice: the envelope's `janus: "success"` **and** the plugin's own `audiobridge` status word (`created`, `destroyed`, `success`).

`permanent: false` + `exists`-first is what makes the system restart-safe: rooms vanish on a Janus restart and the next credential mint recreates them with the *same* derived pin/secret (§3).

### 4.4 Invariants and failure semantics

- **DB first, media best-effort.** Meeting orchestration is deliberately *not* `@Transactional`; each flow commits its DB transition via `MeetingStateService` and only then calls the media plane. Every Janus method swallows its own failures (WARN + `false`), so a Janus outage can never roll back or fail a committed transition — meetings keep working, silently without audio.
- **The one exception — host mute runs media *before* DB** (`MeetingParticipantService.muteParticipant` → `adminMute` → `setMuted`): the mix must drop the feeder first, so the DB flag never claims muted while the mic still feeds the mix; if the DB write then failed, the roster flag self-corrects on the client's next `configure` (`docs/meeting-media-architecture.md` §5.4).
- **Self-healing rooms.** `MediaTokenService.mintFor` re-ensures both rooms on every mint (every `/me`/`join` response of a JOINED participant), so a room lost to a Janus restart or a failed create reappears on the next poll — with unchanged credentials, since they are derived, not stored.
- **Known benign WARN**: host-muting a participant who has not joined the bridge yet logs `No such user … in room …` (AudioBridge error 492) and still persists the DB flag — by design; the bridge has no feeder to act on yet (`docs/implementation-status.md` §3).

### 4.5 What the client receives

`MediaTokenService.mintFor` → `MediaCredentialsDTO`, minted **only** when the DB says the participant is JOINED and the meeting IN_PROGRESS (everyone else gets `media: null` — the waiting-room contract):

| Field | Value |
|---|---|
| `liveKitUrl` / `liveKitToken` | video plane — `docs/meeting-media-architecture.md` §4.1 |
| `janusWsUrl` | `app.janus.ws-url` (`ws://localhost:8188`) |
| `janusRoomId` | `meetings.id` |
| `janusPin` | the derived room pin (§3) |
| `muted` | the DB `muted` flag — join the bridge pre-muted when `true` |

## 5. Browser protocol (the join contract)

The browser speaks Janus's JSON protocol directly over the WebSocket at `janusWsUrl` — `janus.js` is deliberately **not** a dependency (global-script library, bundler-hostile; the protocol surface is small enough for a typed hand-rolled client, `docs/meeting-media-architecture.md` §6). The session dance is the same as §4.3 but over WS:

1. connect `ws://localhost:8188` → `{"janus":"create"}` → attach `janus.plugin.audiobridge`
2. **join** — the whole admission contract in one message:

```json
{
  "request": "join",
  "room": 42,
  "id": 7,
  "pin": "a1b2c3d4",
  "display": "Nam",
  "muted": true
}
```

3. **self-mute** — `configure` (`{"request":"configure","muted":true}`); the client does this *before* the `PATCH …/participants/me/mute` that persists the flag (latency first)
4. listen for **`talking`** events (AudioBridge audio-level detection)
5. on exit: `leave` or just close the socket — Spring's `/leave` is a pure DB transition

Status: this client has **not landed yet** (`docs/implementation-status.md` §1) — the speaking indicator currently comes from client-local mic analysis, and `talking` events are the planned native replacement. Until that spike lands, `enforce_cors` on the WS transport stays `false` (§2.3).

## 6. Operations & troubleshooting

```bash
docker compose up -d                     # builds myrooms-janus:1.4.2 on first run (~5 min)
curl -s localhost:8088/janus/info        # health/version — expect version_string "1.4.2"
docker logs myrooms-janus                # plugin + transport logs
```

**Does room 42 exist?** — the same ephemeral dance Spring does (§4.3), runnable from the host:

```bash
post() { curl -s -X POST "localhost:8088/janus$1" -H 'Content-Type: application/json' -d "$2"; }
SID=$(post "" '{"janus":"create","transaction":"dbg"}' | grep -o '"id":[0-9]*' | cut -d: -f2)
HID=$(post "/$SID" '{"janus":"attach","plugin":"janus.plugin.audiobridge","transaction":"dbg"}' | grep -o '"id":[0-9]*' | cut -d: -f2)
post "/$SID/$HID" '{"janus":"message","transaction":"dbg","body":{"request":"exists","room":42}}'
post "/$SID" '{"janus":"destroy","transaction":"dbg"}' >/dev/null
```

| Symptom | Cause / handling |
|---|---|
| Meetings work but no audio, Spring logs `AudioBridge … failed` | Janus down/unreachable — meetings continue (§4.4); rooms self-heal on the next mint once it's back |
| `WARN … No such user … in room …` (error 492) | host-mute before the target joined the bridge — benign, by design (§4.4) |
| Room creation fails authorization | `app.janus.admin-key` ≠ jcfg `admin_key` (§2.4) |
| Admin ops fail on an old room after a pepper change | expected — rotate the pepper only between meetings (§3) |
| Browser cannot reach `ws://localhost:8188` | container down, or (post-spike) `enforce_cors`/`allow_origin` mismatch with the Angular origin |
| Odd one-way/no media on macOS Docker | UDP-range forwarding is the flakiest part of local WebRTC dev — see the macOS + `TURN_EXTERNAL_IP` notes in `docs/implementation-status.md` §3 |

Two structural facts to keep in mind: **8088 (Janus HTTP) vs 8083 (Spring API)** are one digit apart; and Janus has **no outbound webhooks** — audio-plane presence is derived from the app's own admission records (`status = JOINED` in `meeting_participants`); `listparticipants` exists if a reconciliation view is ever needed. License note: Janus is GPLv3 — fine self-hosted, revisit only if the product is ever distributed as a hosted binary.
