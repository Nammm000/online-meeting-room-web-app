# Implementation Status & Remaining Work

Status as of 2026-10-02. The media-plane implementation (LiveKit video SFU + Janus AudioBridge audio MCU + coturn infra, and the full Spring Boot meeting control plane) is **complete, smoke-tested end-to-end, and unit-tested (90 tests green)**. This file tracks what is deliberately *not* built yet, plus verified-during-implementation caveats the next session should know. Delete items as they land; delete the file when it's empty.

## 1. Deliberately out of scope (next major task)

- **Angular meeting UI** — no frontend code exists for meetings. The join/`/me` response already carries everything the client needs (`MyMeetingStatusDTO.media`: LiveKit URL + JWT, Janus WS URL + room id + pin + muted flag). The design is §6 of `meeting-media-architecture.md` (two PeerConnections behind one facade, avatar-when-no-video, `livekit-client` npm + hand-rolled typed Janus WS client). Frontend conventions to follow: the notification-service WebSocket lifecycle pattern (session-scoped `effect()`, stale-socket discipline, refresh-before-reconnect), signals everywhere (zoneless), `isPlatformBrowser` guards (SSR is on), i18n keys in both `en` and `vi` (build fails otherwise), and `environment.ts` gains `liveKitUrl`/`janusWsUrl`.
- **Real WebRTC validation** — the AudioBridge join contract (`id = users.id`, `pin`, `muted`) and the LiveKit token grants are unit-/smoke-verified at the control-plane level, but no browser has ever connected. First UI milestone must include: two-tab join test, host-mute actually silencing the bridge feeder, the **mix-minus spike** (does a participant hear themselves? doc caveat 1), and cross-PC A/V sync perception.
- **LiveKit webhooks with real events** — signature validation and event handling are unit-tested; a real `participant_left` only fires once browsers connect. Verify one lands during the two-tab test.

## 2. Known gaps carried forward (pre-existing or deferred by decision)

- **Per-user WebSocket push** (`websocket.md` gap): the lobby host and mute victims are poll-based today (`/me`, `/lobby`, ≥500 ms intervals — the rate limiter allows 3 req/s per user). Extend the notification WS to per-user sends when the UI needs snappier UX.
- **`GET /users/{id}/avatar`** — `/images/avatar` is owner-scoped; the roster's avatar-when-no-video tiles need other users' avatars, streamed through Spring (MinIO stays unexposed).
- **`UserService.deleteUser` cleanup** — still a bare `deleteById` (pre-existing, fails on FK once a user has meeting rows). All repo methods for the fix already exist; recipe in `meeting-database-design.md` §6.
- **`enforce_cors` on the Janus WS transport** is deliberately permissive (`false`) until the browser client spike; tighten to the Angular origin afterwards (`docker/janus/etc/janus.d/janus.transport.websockets.jcfg`).
- **`MeetingRoomUtils.getResponseEntity`** still emits the misspelled `"messag"` JSON key — the meeting endpoints reuse it as-is for house consistency; a fix would touch every client string parse at once.

## 3. Operational notes (verified the hard way)

- **coturn 4.18 removed `--no-tls`, `--no-dtls`, `--log-device=stdout`** — any of them makes turnserver print usage and exit 255 in a restart loop. The Alpine image also has **no `nc`**, hence the `/proc/net` healthcheck. Fixed in `docker-compose.yml` (commit `fix(infra): coturn 4.18 flag set and healthcheck`).
- **Janus has no official Docker image; community ones are stale** — we build v1.4.2 from source (`docker/janus/Dockerfile`, ~5 min first build). It needed `libglib2.0-dev libconfig-dev zlib1g-dev`; `--enable-post-processing` was dropped (pulls ffmpeg dev libs; only needed for recording conversion).
- **coturn `--external-ip` defaults to 127.0.0.1** — set `TURN_EXTERNAL_IP=<LAN IP>` in the environment for real-device/LAN dev; relay is loopback-only otherwise.
- **macOS Docker UDP-range forwarding** (50100-50200, 51000-51100, 61000-61100) is the flakiest part of local WebRTC — expect oddities on localhost and verify on a real network before doubting the architecture.
- **LiveKit admin API needs a Bearer JWT** (HTTP basic auth is rejected). The `lk` CLI (`npm i -g @livekit/cli`) is the easiest ops window: `lk room list --url ws://localhost:7880 --api-key devkey --api-secret <app.livekit.api-secret>`.
- **`8088` (Janus HTTP admin) vs `8083` (Spring API)** remain visually confusable — port labels are commented in compose.
- **Host-mute before the target joins the bridge** logs a WARN (`No such user … in room …`, AudioBridge error 492) and persists the DB flag anyway — by design; the bridge applies nothing because the feeder doesn't exist yet. Once the UI joins with `id = users.id` this path fully works.

## 4. Verification quick-reference (all green at time of writing)

```bash
export JAVA_HOME=/Users/namnlh/Library/Java/JavaVirtualMachines/ms-17.0.18/Contents/Home
cd server
mvn clean package                       # 90 tests, BUILD SUCCESS
docker compose up -d                    # six containers healthy
curl -s localhost:7880                  # LiveKit: OK
curl -s localhost:8088/janus/info       # Janus: server_info, version_string 1.4.2
# full curl smoke-test script: see git history / conversation — signup → create INSTANT
# meeting w/ waiting room → join (WAITING, no media) → admit → /me (tokens) → roster →
# mute → chat → lock (409 on join) → end → psql shows JOINED→LEFT, both rooms torn down
```
