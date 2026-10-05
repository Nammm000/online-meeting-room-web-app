# Implementation Status & Remaining Work

Status as of 2026-10-05. The media-plane implementation (LiveKit video SFU + Janus AudioBridge audio MCU + coturn infra, and the full Spring Boot meeting control plane) is **complete, smoke-tested end-to-end, and unit-tested (142 tests green)**; the full Angular meeting UI is in place (275 frontend tests green). Landed 2026-10-03: **optional meeting password** (BCrypt at create, 403 join gate, host exempt, re-prompt modal), **speaking indicator + stage adjacency** (client-local mic analysis → `PATCH /participants/me/speaking` → roster-propagated `speaking`/`lastSpeakingAt`; self pinned first, speakers adjacent; roster polled every 2.5 s), **private chat messages** (nullable `recipient_id`, per-viewer visibility filter, "To:" recipient picker), and **raise hand** (`PATCH /participants/me/hand` self-toggle + `PATCH /participants/{userId}/hand` moderator lower-hand; `handRaised`/`lastHandRaisedAt` ride the roster poll to the tile/roster badge; no mute clamp, reset on leave/rejoin/meeting end — DB-design rule 9). Landed 2026-10-04: **browser video + exclusive screen share** (`livekit-client` behind the `MeetingMediaService` facade — click-to-view camera tiles with avatar images (`GET /images/avatar/{userId}`, initials fallback) + hover info card (name/role/email); exclusive share slot `meetings.screen_sharer_id` claimed atomically, second claim 409s with the exact client-displayed string; prominent auto-view share panel; host camera-off and stop-share via LiveKit `updateParticipant` entitlements, restrict-only; `video_enabled` persists across rejoin; per-participant token grants self-heal on re-mint — DB-design rule 10, media-architecture §5.4/§5.4a). Landed 2026-10-05: **emoji reactions** (Heart/Laugh/Cry/Like from the room toolbar; floated ephemerally over the LiveKit data channel — `canPublishData: true` in `mintToken` + `applyPublishEntitlements`, lossy `topic: 'reaction'` JSON, optimistic local float for the sender, no persistence; the only non-REST cross-client channel, and it carries nothing durable). This file tracks what is deliberately *not* built yet, plus verified-during-implementation caveats the next session should know. Delete items as they land; delete the file when it's empty.

## 1. Deliberately out of scope (next major task)

- **Real WebRTC validation** — the LiveKit video plane is wired browser-side (`MeetingMediaService`, click-to-view tiles, exclusive screen share) and unit-tested at the control-plane level, but **no two-browser media session has been run end-to-end** yet. First validation pass must include: two-tab join (camera click-to-view both ways, share panel on both), host camera-off / stop-share actually tearing down live tracks, the browser-native "Stop sharing" releasing the slot, a mid-share tab close (`participant_left` frees the slot), the AudioBridge **mix-minus spike** (does a participant hear themselves? doc caveat 1), and cross-PC A/V sync perception.
- **Native speaking events** — LiveKit gets no mic track (audio is Janus's), so `ActiveSpeakersChanged` never fires; `SpeechDetectionService` stays the speaking source by design. If the Janus WS client lands with talking events, they can replace it — the throttled PATCH wiring and the `speaking` column stay as-is.
- **LiveKit webhooks with real events** — signature validation and event handling are unit-tested; a real `participant_left` only fires once browsers connect. Verify one lands during the two-tab test (it also frees the share slot via `markLeftIfJoined`).

## 2. Known gaps carried forward (pre-existing or deferred by decision)

- **Per-user WebSocket push** (`websocket.md` gap): the lobby host, mute victims and share-slot changes are poll-based today (`/me` carries `screenSharerUserId` at ~2 s, the roster at 2.5 s — the rate limiter allows 3 req/s per user). Speaking feedback, raise-hand indication and share-slot transitions are therefore poll-bound (~2–3 s lag) until per-user sends exist.
- **Meeting password is create-time only** — no change/remove/CAPTCHA endpoint; a password set at creation can only be dropped by... nothing yet. Add `PATCH /{joinCode}/password` if ever needed.
- **Host cannot moderate private messages they cannot see** — PM visibility excludes the host by design; host delete of a PM id 404s (author-only). Accepted trade-off.
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
