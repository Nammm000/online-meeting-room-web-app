---
description: Layered architecture — controllers, services, repos, and cross-cutting filters/security/cache/storage/websocket components
alwaysApply: true
---

# Architecture

Standard layered structure: `controllers` → `services` (per domain: `auth` — `auth/`, `refreshToken/`, `RefreshCookieService`; `user`; `jwt`; `image`; `pdf`; `meeting` — orchestrators `MeetingService`/`MeetingParticipantService`/`MeetingChatService` (NOT @Transactional — DB transitions commit via `MeetingStateService` first, media calls follow best-effort), the `MeetingAuthority` permission guard, and `JoinCodeGenerator`; `media` — `LiveKitMediaService` (SDK rooms+tokens), `JanusAudioBridgeClient` (AudioBridge admin over ephemeral HTTP sessions via `JanusHttpTransport`), `RoomSecretDeriver` (deterministic per-room secret/pin), `MediaTokenService` — never throw, log and return false) → `repo` (Spring Data JPA) → PostgreSQL. MinIO (S3-compatible) backs the image and pdf domains; LiveKit (video SFU) + Janus AudioBridge (audio MCU) + coturn back the meeting media plane (design: `docs/meeting-media-architecture.md`, infra: `docker-compose.yml` + `docker/`).

Cross-cutting pieces:

- `filters/JwtRequestFilter` — Bearer-token auth (see `security-auth.md`)
- `filters/RateLimitFilter` + `util/SlidingWindowRateLimiter` — sliding-window rate limiting, 429 + `Retry-After` (see `security-auth.md`)
- `configuration/WebSecurityConfiguration` — filter chain, CORS (`CorsConfigurationSource` from `app.client.url`), `PasswordEncoder`/`AuthenticationManager` beans
- `configuration/RedisCacheConfig` — Redis-backed cache manager (Jackson serializer with default typing, randomized 5–10 min TTL, `CacheErrorHandler` that logs and degrades to DB). Backs the two PDF read paths — `@Cacheable` on `UserPdfFileService.getMyPdfFiles`/`getPdfFile` with per-user keys (`<email>:<page>:<size>` / `<email>:<id>`), `@CacheEvict` (both caches, `allEntries`) on the upload/delete methods and on `UserService.deleteUser` (cache names in `constants/CacheConstants`; design: `docs/redis.md`).
- `configuration/MinioConfiguration` — `MinioClient` bean + eager bucket bootstrap; the app fails to start if MinIO is unreachable
- `configuration/RequestSecurityContext` — request-scoped username/role/user holder populated by `JwtRequestFilter` and consumed by `UserUtils`
- `exception/AllExceptionHandler` (global @ControllerAdvice, see `exception-handling.md`)
- `websocket/` — `WebSocketConfiguration`, `NotificationWebSocketHandler`, `WebSocketAuthInterceptor`, `NotificationScheduler` (endpoint behavior in `api-surface.md`)
- `dto/` for request/response shapes; `wrapper/` for query projections (e.g. `UserWrapper`); `constants/` (`AuthConstants`, `CacheConstants`, plus the `AssetConstants`/`PaymentConstants` remnants noted in `project-overview.md`)
- `util/` — `UserUtils` (current-user resolution + ownership checks), `MeetingRoomUtils` (response helpers), `JwtUtil`, `EmailUtil`, `TimeUtil`

Endpoint map and controller conventions: see `api-surface.md`.
