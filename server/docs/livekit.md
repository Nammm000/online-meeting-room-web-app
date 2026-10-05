# LiveKit (video SFU)

LiveKit is the **video half** of the meeting media plane: a self-hosted WebRTC **SFU (selective forwarding unit)** that relays camera and screen-share tracks from publishers to subscribers **without decoding or mixing anything** — server cost tracks *active publishers*, not room size. The audio half is the Janus AudioBridge MCU (`docs/janus.md`); NAT traversal for both PeerConnections is coturn; the split rationale lives in `docs/meeting-media-architecture.md` §2–§3. Spring Boot is the **control plane**: it is the only holder of the API key/secret, creates and deletes rooms, mints short-TTL access tokens whose grants encode each participant's publish rights, pushes live-session permission changes, and consumes LiveKit's signed webhooks. Implementation status: server **and** browser client are landed and unit-tested (2026-10-04); a real two-browser WebRTC session has not been run end-to-end yet (`docs/implementation-status.md` §1).

Room keying, stated once because it is deliberately asymmetric with the audio plane: **LiveKit room name = the meeting's `join_code`** (Janus's room id is the numeric `meetings.id`), and every participant connects with **identity = `users.id` as a string** — the identity is what `removeParticipant` and `updateParticipant` target, and what the browser uses to map remote tracks back to roster rows.

## 1. How video data is transmitted

```
  camera A ──►┐                                    ┌──► B subscribes to A (click-to-view)
  camera B ──►├─ LiveKit SFU, room = join_code ────┼──► C subscribes to A
  share  A ──►┘   forwards encoded frames as-is;   └──► everyone subscribes to the share
                  never decodes, never mixes
```

- **Forwarding, not mixing**: each publisher sends one encoded track (optionally simulcast layers) to the SFU; the SFU relays the chosen layer to every subscriber. No server-side decode/re-encode — that economy is why video gets an SFU where audio gets an MCU (`docs/meeting-media-architecture.md` §2).
- **Sparse-video economics**: most participants publish **nothing** (their tile shows an avatar), and a cameras-off participant costs the server exactly zero bytes. Worked example — 10-person meeting, 2 cameras (low layer ≈150 kbps) + 1 screen share (≈1.5 Mbps) ≈ 1.8 Mbps per viewer, ≈16 Mbps total egress (§8 of the architecture doc).
- **On-demand subscription**: the browser connects with `autoSubscribe: false` — camera tracks are subscribed only on click-to-view, the screen share is the one stream everyone auto-subscribes (§5). Server egress therefore also tracks *viewer interest*, not just publications.
- **No audio over LiveKit, ever**: microphone publishing is excluded server-side by the token grant's source allowlist (`camera`/`screen_share` only — §3), not by client cooperation.
- coturn (`:3478`, STUN/TURN) is the shared relay fallback for symmetric-NAT clients; LiveKit's own embedded TURN is disabled in config (§2.2) because coturn owns the port.

## 2. Deployment & configuration

### 2.1 Container

```yaml
livekit:
  image: livekit/livekit-server:v1.13.7
  container_name: myrooms-livekit
  restart: always
  command: ["--config", "/etc/livekit/livekit.yaml"]
  ports:
    - "7880:7880/tcp"
    - "50100-50200:50100-50200/udp"
  volumes:
    - ./docker/livekit/livekit.yaml:/etc/livekit/livekit.yaml:ro
  healthcheck:
    test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:7880/ 2>/dev/null || nc -z localhost 7880"]
```

| Port | Protocol | Who talks to it | Purpose |
|---|---|---|---|
| 7880 | tcp | browsers (WS/HTTP signaling) **and** Spring (twirp admin API) | one port for both surfaces — `app.livekit.url` and the browser's connect URL |
| 7881 | tcp | — | ICE-over-TCP fallback; **not published** in dev (UDP-only). Publish it if a client network blocks UDP |
| 50100–50200 | udp | media plane | RTC range; must equal `rtc.port_range_start/end` in the yaml |

The admin API needs a **Bearer JWT** (HTTP basic auth is rejected) — the easiest ops window is the `lk` CLI (§6). On Linux, the webhook target needs `extra_hosts: ["host.docker.internal:host-gateway"]` on the livekit service.

### 2.2 Server configuration

`docker/livekit/livekit.yaml`, mounted read-only:

```yaml
port: 7880

keys:
  devkey: "devlksecret-8c2f41a9d6e03b5741cafeb2d90863"

rtc:
  # Narrowed from the 50000-60000 default; must match the published UDP range
  # in docker-compose.yml (macOS Docker Desktop handles smaller ranges better).
  port_range_start: 50100
  port_range_end: 50200
  tcp_port: 7881 # not published in dev (UDP-only ICE); publish if a network blocks UDP
  use_external_ip: false # macOS/LAN dev; true only for cloud hosts behind 1:1 NAT

# coturn owns TURN on 3478 — LiveKit's embedded TURN stays off.
turn:
  enabled: false

# Signed webhooks to the Spring control plane. api_key selects WHICH key signs
# the JWT (required — without it no webhook is signed). host.docker.internal
# resolves to the host on Docker Desktop (macOS/Windows).
webhook:
  api_key: devkey
  urls:
    - http://host.docker.internal:8083/webhooks/livekit
```

### 2.3 Spring properties

```properties
app.livekit.url=http://localhost:7880
app.livekit.api-key=devkey
app.livekit.api-secret=devlksecret-8c2f41a9d6e03b5741cafeb2d90863
app.livekit.token-ttl=PT5M
app.livekit.room-empty-timeout-seconds=900
```

Bound by `configuration/LiveKitProperties` (registered in `configuration/MediaConfiguration`, which also builds the only two objects that ever touch the key/secret: the `RoomServiceClient` admin client and the `WebhookReceiver` verifier). The server SDK is `io.livekit:livekit-server:0.16.0` from Maven — the official Java SDK, which is exactly why this stack needs no Node sidecar (`docs/meeting-media-architecture.md` §3).

| Property | Meaning |
|---|---|
| `url` | both surfaces: browser signaling and Spring's admin API |
| `api-key` / `api-secret` | the signing pair — must exist in the yaml `keys` map |
| `token-ttl` | access-token lifetime (5 min) — bounds the reconnect window of a removed participant whose revocation call failed |
| `room-empty-timeout-seconds` | `emptyTimeout` set at room creation (900 s) — the orphan-room backstop when a `deleteRoom` fails |

Values that must stay in sync by hand — nothing validates them:

| One side | Other side | Note |
|---|---|---|
| yaml `keys: devkey: "devlksecret-…"` | `app.livekit.api-key` / `api-secret` | mismatch ⇒ every admin call and every token 401s |
| yaml `rtc.port_range_start/end: 50100/50200` | compose `ports: 50100-50200/udp` | mismatch ⇒ media can never flow |
| yaml `webhook.api_key: devkey` | must name a key in `keys` | omitted ⇒ no webhook is signed at all |

## 3. Token & permission model

Admission to a LiveKit room is **token-only**: Spring mints a short-TTL JWT (HMAC-signed with the api-secret) and hands it to the client in `MediaCredentialsDTO.liveKitToken` — minted only when the DB says the participant is JOINED and the meeting IN_PROGRESS. Postgres is the single gatekeeper; the token is the door.

`LiveKitMediaService.mintToken` builds the grants:

| Grant | Value | Why |
|---|---|---|
| `roomJoin` / `room` | `true` / `join_code` | one room per token |
| `identity` / `name` | `users.id` as string / display name | identity is what `removeParticipant`/`updateParticipant` target and how the client maps tracks to roster rows |
| `canSubscribe` | `true` | viewing is unrestricted (subscription itself is on-demand, §5) |
| `canPublishSources` | `["camera"]`, `["screen_share"]`, or both — **derived from the DB on every mint** (`video_enabled`, share-slot ownership) | the allowlist is what keeps the microphone out: `mic`/`microphone` is never in the list |
| — fully restricted participant | **hard `canPublish: false`** | an *empty* `canPublishSources` would mean **ALL sources** in LiveKit — the trap `mintToken` sidesteps |
| `canPublishData` | `false` | no data channels by design — REST (`/meetings/**`) is the only cross-client channel |

Two consequences worth internalizing:

- **Grants bind at connect time only.** Changing a connected participant's rights goes through `applyPublishEntitlements` (`updateParticipant`), a *second* enforcement layer on the live session. Both layers derive from the same DB columns, so they can't disagree for long.
- **Re-mints self-heal.** A fresh token rides every `/me` poll (§5); a reconnect picks up whatever the DB now says — a missed entitlements call corrects itself on the next connect.

## 4. Spring control-plane usage

### 4.1 The classes

| Class | Role |
|---|---|
| `configuration/LiveKitProperties` | the `app.livekit.*` record |
| `configuration/MediaConfiguration` | builds `RoomServiceClient` + `WebhookReceiver` — the only holders of the key/secret |
| `services/media/LiveKitMediaService` | the admin surface — rooms, removal, live entitlements, token minting; **never throws** (WARN + `false`), same best-effort contract as the Janus client (`docs/janus.md` §4.4) |
| `services/media/MediaTokenService` | composes both planes' credentials; lazy `ensureRoom` self-heal |
| `controllers/LiveKitWebhookController` | the signed-webhook sink (§4.3) |

### 4.2 Operations and their callers

| Method | RoomService / SDK call | Called from |
|---|---|---|
| `ensureRoom(joinCode)` | `createRoom(joinCode, emptyTimeout=900s)` — idempotent, LiveKit returns the existing room | `MeetingService.create` (INSTANT) and `start`; lazily on every `MediaTokenService.mintFor` — the self-heal |
| `deleteRoom(joinCode)` | `deleteRoom` | `MeetingService.end` — after the rule-4 tx (ENDED + bulk JOINED→LEFT), before the Janus `destroyRoom` |
| `removeParticipant(joinCode, userId)` | `removeParticipant(joinCode, identity, revokeTokenTs = now)` — disconnects **and revokes every token issued before now** | `MeetingParticipantService.removeParticipant` (after the DB tx, alongside the Janus `kick`) |
| `applyPublishEntitlements(joinCode, userId, camera, share)` | `updateParticipant` with `ParticipantPermission` (`canSubscribe` true, `canPublish` iff any source, `canPublishData` false, sources per flags) | self camera toggle, host camera-off, screen-share claim/release/stop |
| `mintToken(…)` | `AccessToken` → JWT (§3) | `MediaTokenService.mintFor` |

**Ordering nuances** (the DB-first rule has two deliberate inversions on this plane, both because a live *session* must be told before the record changes):

- *Restrict-first*: host camera-off and stop-share drop the live entitlement **before** the DB write — the reverse would leave a window where the DB says restricted but the track still streams.
- *Claim-last*: the screen-share **claim** is the opposite — the exclusive slot is won atomically in the DB first (`meetings.screen_sharer_id` conditional UPDATE), and only then does the live session gain the `screen_share` source; you cannot hand out an entitlement for a slot nobody owns.
- Target offline ⇒ `IOException` ⇒ WARN + `false`, DB flag still commits — the next minted token carries the restriction (the same contract as a Janus host-mute before bridge join, `docs/janus.md` §4.4).

### 4.3 Webhooks — `POST /webhooks/livekit`

The path is `permitAll` in the security chain; the **real** gate is in the endpoint — the SDK's `WebhookReceiver` verifies the `Authorization` JWT's HMAC signature **and** the body sha256 digest (the controller consumes the raw body as a String: the exact bytes LiveKit signed). Failure ⇒ 401 via the existing handler. The handler always answers 200 fast — a non-2xx makes LiveKit retry, including for events we deliberately ignore.

| Event | Handling |
|---|---|
| `participant_left` | the only mutating event: `findByJoinCode(room)` → idempotent `markLeftIfJoined(meetingId, identity)` — also frees the share slot. Non-numeric identity or unknown room ⇒ WARN/ignore |
| `participant_joined` | debug log only — connectivity is UI state; the DB deliberately has no presence column |
| `room_finished` | logged, ignored — **DB wins**: a media room dying never ends a meeting the host hasn't ended |
| anything else | debug log |

Event policy is unit-tested in `LiveKitWebhookControllerTest` (bad signature → 401, LEFT transition, non-numeric identity, unknown room, `room_finished` never ends the meeting, `participant_joined` mutates nothing).

## 5. Browser client (Angular — landed)

The frontend (`frontend/`, Angular 21.2, `livekit-client` ^2.22.3) wraps the SDK in **`MeetingMediaService`** (`src/app/service/meeting-media.service.ts`) — a signal facade the rest of the app consumes without ever touching WebRTC:

- **Credentials come from the API only.** `environment.ts` carries no LiveKit URL or token; both arrive in the `/me` poll's `media` block (`MediaCredentialsDTO.liveKitUrl`/`liveKitToken`). `offerCredentials` runs on every poll: a connected room just stores the freshest token (for the next reconnect — re-minted grants self-heal, §3), a disconnected one connects with it.
- **The SDK is dynamically imported** behind `isPlatformBrowser` — SSR safety and bundle budget (it never lands in the initial chunk); in jsdom, `mediaDevices` guards make camera/screen calls inert no-ops, so unit tests need no device stubs.
- **Connect**: `room.connect(url, token, { autoSubscribe: false })`. Reconnect on `Disconnected` while armed, exponential backoff 1 s → 10 s cap; never on a grant change.
- **Publish**: `localParticipant.setCameraEnabled/setScreenShareEnabled`. `LocalTrackPublished/Unpublished` flip the `cameraPublishing`/`screenSharing` signals — which is how the browser's native "Stop sharing" bar releases the exclusive slot: the ended track lands in `LocalTrackUnpublished`, the room service sees `screenSharing() === false` and PATCHes the server release.
- **Subscribe (click-to-view)**: the pure `shouldAutoSubscribe` rule — `screen_share` always subscribed, a `camera` only once its tile is clicked (click-again unsubscribes). `TrackPublished` applies the decision, `reconcilePublications` replays it over the join snapshot (participants already present when you connect), `TrackSubscribed/Unsubscribed` maintain `remoteCameraTracks` (map keyed by `Number(participant.identity)` = users.id) and the single `screenShareTrack`.
- **Tiles**: a video tile renders iff a subscribed remote track exists (or it's the viewer's own camera); otherwise the avatar (`GET /images/avatar/{userId}`) with an initials fallback. No camera by default — the sparse-video premise of §1.

## 6. Operations & troubleshooting

```bash
docker compose up -d                     # pulls livekit/livekit-server:v1.13.7
curl -s localhost:7880                   # health — expect "OK"
docker logs myrooms-livekit              # server logs

# rooms from the host (admin API needs the signed JWT — the CLI does it for you):
npm i -g @livekit/cli
lk room list --url ws://localhost:7880 --api-key devkey \
   --api-secret devlksecret-8c2f41a9d6e03b5741cafeb2d90863
```

| Symptom | Cause / handling |
|---|---|
| Every admin call / every connect 401s | yaml `keys` ≠ `app.livekit.api-key/api-secret` (§2.3) |
| Signaling connects, no video ever flows | yaml `rtc.port_range_*` ≠ compose UDP range; or macOS Docker UDP forwarding (flakiest part of local WebRTC dev — verify on a real LAN, `docs/implementation-status.md` §3) |
| Client network blocks UDP entirely | publish `7881/tcp` (ICE-over-TCP) — it exists in the yaml but is unpublished in dev |
| Webhooks never arrive | `webhook.api_key` missing in the yaml (nothing signs), or Linux without `extra_hosts: host.docker.internal:host-gateway` |
| Spring logs `LiveKit … failed` but meetings keep working | expected — best-effort contract (§4.1); rooms self-heal on the next mint |
| Orphan room after a failed end-meeting | `emptyTimeout` (900 s) is the backstop; confirm with `lk room list` |
| Removed participant reconnects | revocation (`revokeTokenTs`) should prevent it; the 5-min token TTL bounds the window if that call failed |
| `updateParticipant` WARNs | target participant offline — the DB flag still committed, the next token carries it (§4.2) |

Two do-not-use rules inherited from the architecture decision (`docs/meeting-media-architecture.md` §4.1): LiveKit's built-in **chat and data channels are never used** (`canPublishData: false` — the app owns chat in `meeting_chat_messages`), and LiveKit participant metadata is **not the roster** — `meeting_participants` is the truth, LiveKit participants are a projection.
