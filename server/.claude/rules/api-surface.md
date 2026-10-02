---
description: REST API surface — endpoint map per controller, DTO conventions, and per-endpoint authorization
globs:
  - "src/main/java/**/controllers/**"
alwaysApply: false
---

# API Surface

Controllers live in `controllers/` — eight: `AuthenticationController`, `UserController`, `UserImageController`, `UserPdfFileController`, plus the meeting domain's `MeetingController`, `MeetingParticipantController`, `MeetingChatController`, and `LiveKitWebhookController`. "Current user" endpoints resolve via `UserUtils`; per-resource authorization is `UserUtils.checkOwnership` in services (see conventions below), and the meeting domain uses `services/meeting/MeetingAuthority` (permission table in `docs/meeting-database-design.md` §3).

## API Table

### Meetings — `/meetings` (JWT)

| Method | Endpoint | Parameters | Description | Auth |
| ------ | -------- | ---------- | ----------- | ---- |
| POST | `/meetings` | body: `CreateMeetingRequest` `{title, description, type: SCHEDULED\|INSTANT, scheduledStartAt, scheduledEndAt, waitingRoomEnabled, muteOnEntry}` | Creates meeting + HOST participant row in one tx. INSTANT → `IN_PROGRESS` with host JOINED and media rooms ensured (response carries host `media` credentials); SCHEDULED requires both timestamps (end after start), host row starts LEFT. 201 `MeetingDTO` | JWT |
| GET | `/meetings/my` | `page`, `size` | Meetings hosted by the caller, fixed sort `createdAt DESC` → `PagedResponseDTO<MeetingDTO>` | JWT |
| GET | `/meetings/{joinCode}` | — | Pre-join metadata by join code (never id) — 404 unknown code | JWT |
| PATCH | `/meetings/{id}/start` | — | Host only, SCHEDULED→IN_PROGRESS (+`actualStartAt`, host row→JOINED, media rooms ensured); 409 wrong status | JWT |
| PATCH | `/meetings/{id}/cancel` | — | Host only, SCHEDULED→CANCELLED | JWT |
| PATCH | `/meetings/{id}/end` | — | Host only: rule-4 tx (ENDED + bulk JOINED→LEFT) then LiveKit `deleteRoom` + AudioBridge `destroy` best-effort | JWT |

### Participation & moderation — `/meetings/{joinCode}` (JWT)

| Method | Endpoint | Parameters | Description | Auth |
| ------ | -------- | ---------- | ----------- | ---- |
| POST | `/{joinCode}/join` | — | Requires IN_PROGRESS (409) + not locked (409). Waiting room off → JOINED + `media` credentials; on → WAITING, `media: null`. LEFT/DECLINED rejoin in place (`joinCount++`); REMOVED/DENIED always route to WAITING. → `MyMeetingStatusDTO` | JWT |
| GET | `/{joinCode}/me` | — | The lobby/presence polling channel (mutates nothing); `media` present iff caller JOINED and meeting IN_PROGRESS | JWT |
| POST | `/{joinCode}/leave` | — | Self-leave: idempotent JOINED→LEFT | JWT |
| GET | `/{joinCode}/lobby` | — | WAITING list — HOST/COHOST only | JWT |
| POST | `/{joinCode}/lobby/{userId}/admit` | — | HOST/COHOST: WAITING→JOINED tx (`admittedBy`, `joinCount++`, `muted = muteOnEntry OR prior`); client picks up credentials on next `/me` poll | JWT |
| POST | `/{joinCode}/lobby/{userId}/deny` | — | HOST/COHOST: WAITING→DENIED (re-request allowed → WAITING) | JWT |
| GET | `/{joinCode}/roster` | — | JOINED list; caller must be JOINED or HOST/COHOST | JWT |
| PATCH | `/{joinCode}/participants/me/mute` | body: `{muted}` | Self-mute persist (client mutes at the bridge first for latency; this survives rejoin) | JWT |
| PATCH | `/{joinCode}/participants/{userId}/mute` | body: `{muted}` | HOST/COHOST (host cannot be muted by someone else): **AudioBridge admin mute first**, then DB | JWT |
| DELETE | `/{joinCode}/participants/{userId}` | — | HOST/COHOST (not HOST target; COHOST cannot remove COHOST): REMOVED tx → LiveKit remove+revoke → AudioBridge kick | JWT |
| PATCH | `/{joinCode}/lock` | body: `{locked}` | HOST only; pure DB flag — the token gate enforces | JWT |
| PATCH | `/{joinCode}/participants/{userId}/role` | body: `{role: COHOST\|PARTICIPANT}` | HOST only; HOST role immutable both ways (409) | JWT |

### Meeting chat — `/meetings/{joinCode}/chat` (JWT)

| Method | Endpoint | Parameters | Description | Auth |
| ------ | -------- | ---------- | ----------- | ---- |
| GET | `/{joinCode}/chat` | `page`, `size` | Paged visible messages, fixed sort `sentAt DESC, id DESC`; any past-or-present participant (viewable after end) | JWT |
| POST | `/{joinCode}/chat` | body: `{content}` (≤2000) | Requires meeting IN_PROGRESS and sender JOINED (409); 201 `ChatMessageDTO` | JWT |
| DELETE | `/{joinCode}/chat/{id}` | — | Soft delete, author or HOST only; idempotent | JWT |

### LiveKit webhooks — `/webhooks/livekit`

| Method | Endpoint | Parameters | Description | Auth |
| ------ | -------- | ---------- | ----------- | ---- |
| POST | `/webhooks/livekit` | raw JSON body + `Authorization: <signed JWT>` | `permitAll` in the chain; the real gate is in-endpoint `WebhookReceiver` (SDK) verifying signature + body sha256 — bad signature → 401. `participant_left` → idempotent JOINED→LEFT (identity = users.id); `participant_joined`/`room_finished` logged only (DB wins). Always answers 200 fast (non-2xx triggers LiveKit retries) | LiveKit signature |

### Authentication — `/auth`

| Method | Endpoint                | Parameters                                         | Description                                                                                       | Auth   |
| ------ | ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| POST   | `/auth/login`           | body: `AuthenticationDTO` `{email, password}`      | Authenticates user, returns `AuthenticationResponse` `{accessToken}` + sets the HttpOnly refresh cookie. A 404-via-sendError branch for disabled users exists in the controller but is unreachable — `UserDetailsServiceImpl` never maps user status to Spring's `enabled` flag (known issue, `project-overview.md`) | Public |
| POST   | `/auth/signup`          | body: `SignupDTO` `{name, email, phone, password}` | Creates user (default BASIC `AccountLevel`, `ACC-<uuid>` account number, role `ROLE_ADMIN`, status `"true"`), returns 201 `AuthenticationResponse` + refresh cookie; already-used email → 409 "This email has already been used." | Public |
| POST   | `/auth/refresh`         | cookie: `asset-manager.refreshToken` (no body)     | Rotates the refresh token: reads the cookie, validates + deletes the old token, sets a rotated cookie, returns `{accessToken}`; missing/expired/replayed cookie → 401 (cookie also cleared) | Public |
| POST   | `/auth/logout`          | cookie: `asset-manager.refreshToken` (no body)     | Clears the SecurityContext, clears the cookie, and revokes the cookie's refresh token, returns `LogoutResponse` | JWT    |
| POST   | `/auth/forgot-password` | body: `{email}`                                    | Emails the user's stored **password hash** via Gmail SMTP — not a usable password (known issue). Always 200, but the message text differs slightly between existing/missing user; SMTP failure → 500 | Public |
| POST   | `/auth/change-password` | body: `{oldPassword, newPassword}`                 | Changes password of the current authenticated user, revokes all their refresh tokens, clears the cookie; wrong old password → 400 "Incorrect Old Password" | JWT    |
| GET    | `/auth/hello`           | —                                                  | Health check, returns `"Hello"`                                                                   | Public |

### User management — `/users` (ADMIN, except current-user)

| Method | Endpoint              | Parameters                                              | Description                                                                           | Auth  |
| ------ | --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----- |
| GET    | `/users`              | —                                                       | Lists all users as `UserWrapper` projections                                          | ADMIN |
| GET    | `/users/current-user` | —                                                       | Returns the caller's own profile as `UserWrapper`; 404 if the user row no longer exists | JWT   |
| PATCH  | `/users/{id}/status` | path: `id`; body: `{status}`                            | Updates user status (enable/disable); unknown id → 404                                | ADMIN |
| PATCH  | `/users/{id}/role`   | path: `id`; body: `{role}` (`ROLE_USER` / `ROLE_ADMIN` / `ROLE_CUSTOMER`) | Updates user role. All three enum values are accepted via `valueOf`; the service's 400 message only names the first two | ADMIN |
| DELETE | `/users/{id}`        | path: `id`                                              | Deletes user                                                                           | ADMIN |

### Notifications — `/ws/notifications` (WebSocket, one-way server→client push)

Raw WebSocket endpoint (no STOMP/SockJS) registered by `websocket/WebSocketConfiguration` with `setAllowedOrigins(app.client.url)`. NOT a REST controller — handled by `websocket/NotificationWebSocketHandler` (`TextWebSocketHandler` tracking sessions in a `CopyOnWriteArraySet`).

- **Connect**: `GET /ws/notifications?token=<accessJWT>` upgrade; `websocket/WebSocketAuthInterceptor` validates the `token` query param (the browser WebSocket API cannot set headers) with the same sequence as `JwtRequestFilter` — missing/invalid/expired/non-access token or unknown user → 401, handshake rejected. Auth is one-time: an open connection outlives the 15-min token.
- **Push**: `websocket/NotificationScheduler` fires every `app.notification.interval-ms` (default 1800000 = 30 min) and broadcasts one JSON text frame to every open session: `NotificationDTO {message, timestamp}` — `message` from `app.notification.message`, `timestamp` an ISO-8601 UTC string (`Instant.toString()`). Global broadcast, no per-user content; a no-op when nobody is connected.

### User images — `/images` (owner-scoped, MinIO-backed)

| Method | Endpoint         | Parameters        | Description                                                                                                                                                        | Auth |
| ------ | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| POST   | `/images/avatar` | multipart: `file` | Uploads/replaces the current user's avatar (upsert — OneToOne unique `user_id`). Only `image/png` / `image/jpeg` / `image/webp`, max 5MB (multipart caps 21MB file / 220MB request so oversize files fail with the clear service message). Stored in MinIO (bucket from `app.minio.bucket`, object key `avatars/<userId>/<uuid>.<ext>` derived from the MIME type, never the client filename); on replace the old object is best-effort deleted. Returns 200 `UserImageDTO` `{id, contentType, fileSize}` | JWT  |
| GET    | `/images/avatar` | —                 | Streams the current user's avatar bytes with the stored Content-Type and `Cache-Control: no-cache`; 404 when none uploaded. MinIO is never exposed to the browser | JWT  |
| DELETE | `/images/avatar` | —                 | Deletes the current user's avatar — DB row first, then best-effort MinIO object removal (orphan object on failure, never a row pointing at a missing object); 404 when none uploaded; plain message 200 | JWT  |

### PDF files — `/pdf-files` (owner-scoped, MinIO-backed)

| Method | Endpoint         | Parameters          | Description                                                                                                                                                        | Auth |
| ------ | ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| POST   | `/pdf-files`     | multipart: `files` (repeated, 1–10) | Uploads 1–10 PDF files for the current user in one request (one rate-limit slot). Per file: `application/pdf` (or blank MIME + `.pdf` extension), non-empty, max 20MB. Object keys `pdfs/<userId>/<uuid>.pdf` in the bucket from `app.minio.pdf-bucket`; the sanitized original filename is stored in `user_pdf_files` for display/download naming only. All files validated before any side effect; on mid-request storage failure the already-created objects are best-effort removed. Returns `201` with a plain `List<UserPdfFileDTO>` `{id, fileName, contentType, fileSize, createdAt}` | JWT  |
| GET    | `/pdf-files`     | `page`, `size`      | Paged list of the current user's PDFs, sorted `createdAt` DESC → `PagedResponseDTO<UserPdfFileDTO>` | JWT  |
| GET    | `/pdf-files/{id}` | —                  | Streams the PDF bytes as `application/pdf` with `Content-Disposition: attachment` carrying the stored filename; ownership-checked (404 unknown id, 403 not owned) | JWT  |
| DELETE | `/pdf-files/{id}` | —                  | Deletes the PDF — DB row first, then best-effort MinIO object removal (avatar precedent); plain message 200 | JWT  |

Conventions:

- DTO in / DTO out via `ResponseEntity` (`dto/` classes); `login`/`refresh`/`logout`/`hello` return bare records/strings instead. Plain-string message responses go through `MeetingRoomUtils.getResponseEntity` — which emits the misspelled JSON key `"messag"` (known issue, `project-overview.md`).
- Paged list endpoints (today only `GET /pdf-files`) take `page`/`size` query params (defaults 0/10) and return `PagedResponseDTO<T>` `{content, page, size, totalElements, totalPages, first, last}`. Sorts are fixed server-side; invalid paging (e.g. negative page) fails `PageRequest.of` → `IllegalArgumentException` → 400 via the catch-all handler.
- Controllers are thin — no try/catch, services throw and `AllExceptionHandler` renders errors (see `exception-handling.md`) — **except `AuthenticationController`**, whose login / forgot-password / change-password hold try/catch and business logic (known issue).
- Per-resource authorization: `UserUtils.checkOwnership(pdfFile)` in `UserPdfFileService` on the by-id download/delete; `ROLE_ADMIN` bypasses the check.
