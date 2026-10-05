# Redis in the Backend

Redis is the Spring Cache backing store used for the two PDF read paths: **the paged list** (`GET /pdf-files`) and **the by-id download** (`GET /pdf-files/{id}`, the MinIO object fetch). No code talks to Redis directly — everything goes through Spring's cache abstraction (`@Cacheable` / `@CacheEvict`) on a `RedisCacheManager`. The pieces:

- `MeetingRoomApplication` — `@EnableCaching(order = 0)` switches proxy-based caching on and pins the cache interceptor **outermost** relative to `@Transactional` (see below).
- `configuration/RedisCacheConfig` — the only class that touches Redis APIs: the `RedisCacheManager` bean (TTL + serializer) and a `CacheErrorHandler` for outages.
- `constants/CacheConstants` — the two cache-name constants; every annotation site uses these, never string literals.
- `services/pdf/UserPdfFileService` — `@Cacheable` on the list and by-id methods, `@CacheEvict` (both caches) on its two write methods.
- `services/user/UserService.deleteUser` — `@CacheEvict` (both caches) for the write that mutates PDFs outside the pdf endpoints.

The split of responsibilities:

- **PostgreSQL + MinIO** stay the source of truth; every write path goes to the DB first and only then evicts cache entries.
- **Redis** holds time-limited (5–10 min, randomized once per startup) copies of already-computed pages and file contents, keyed per user. Losing it costs nothing but a recomputation.

```
browser ──JWT──> frontend ──> backend :8083   GET /pdf-files?page=0&size=10
                                              │  JwtRequestFilter → requestSecurityContext.username
                                              ▼
                                   UserPdfFileController
                                              │  call routed through the caching proxy
                                              ▼
                        cache interceptor — key "<username>:<page>:<size>"
                                              │
                                   Redis GET user-pdf-files::<email>:<page>:<size>
                                     ┌─ hit ──┴──── miss ──────────────────┐
                                     │        service method body runs:    │
                                return the    UserUtils.getCurrentUser() (select)
                                cached DTO    findByUserId(page)           (select)
                                     │        .map(toDTO) → from(...)
                                     │        then PUT the result into Redis (TTL 5-10m)
                                     ▼                    ▼
                                   200 OK               200 OK
```

## 1. Infrastructure (docker-compose.yml)

```yaml
redis:
  image: redis:7-alpine
  container_name: myrooms-redis
  restart: always
  ports: ["6378:6379"]
  volumes: [redis_data:/data]
  healthcheck: ["CMD", "redis-cli", "ping"]
```

- **6378** is the only surface; unauthenticated, matching the dev posture of the exposed Postgres/MinIO credentials. `application.properties` points at `localhost:6378` — the earlier 6379/6378 mismatch (project-overview known issue #5) is fixed.
- Data persists in the `redis_data` named volume (default periodic RDB snapshots — harmless for a cache).
- **No bootstrap step**: unlike MinIO's bucket creation, nothing is created at startup. The cache starts empty and fills on demand; `docker compose up -d` alone is enough.

## 2. Application configuration

`pom.xml` carries two parent-managed starters: `spring-boot-starter-cache` (the annotation model) and `spring-boot-starter-data-redis` (Lettuce client + `spring.data.redis.*` support).

`application.properties`:

| Property | Value                | Purpose |
|---|---|---|
| `spring.data.redis.host` / `port` | `localhost` / `6378` | Point at the compose service |
| `spring.data.redis.timeout` | `2s` | Lettuce **command timeout** — caps how long a cache op may stall when Redis is unreachable |
| `spring.cache.type` | `redis` | Inert once the custom `CacheManager` bean exists (Boot's auto-config backs off via `@ConditionalOnMissingBean`); kept as documentation of the provider choice |

`@EnableCaching(order = 0)` on `MeetingRoomApplication` does two things: enables the cache interceptors, and pins them **outermost** relative to `@Transactional` (which defaults to lowest precedence). Effect: `@CacheEvict` on a transactional writer (`UserService.deleteUser`) fires *after* the DB commit, so a concurrent reader can't refill the cache with pre-commit data.

## 3. Cache configuration — `configuration/RedisCacheConfig`

The class name is deliberately `RedisCacheConfig`, not `RedisCacheConfiguration` — its body imports `org.springframework.data.redis.cache.RedisCacheConfiguration` (TTL/serializer builder), which would collide with the enclosing class's simple name.

**`RedisCacheManager` bean** — a single default cache config:

- `entryTtl(Duration.ofMinutes(ThreadLocalRandom.nextInt(5, 11)))` — every entry expires 5–10 minutes after write (one random value drawn per startup, shared by all entries that boot writes; slight TTL spread across restarts). TTL is the staleness bound if an eviction is ever missed (e.g. rows edited directly in the DB).
- `disableCachingNullValues()` — neither cached method returns null; nothing null is stored.
- No per-cache overrides; both caches are created on demand: `CacheConstants.CACHE_USER_PDFS` = `"user-pdf-files"` (paged lists, key `<email>:<page>:<size>`) and `CacheConstants.CACHE_USER_PDF` = `"user-pdf-file"` (by-id content, key `<email>:<id>`) — the singular/plural pair is why every annotation site uses the constants, never string literals.

**Serialization** — `GenericJackson2JsonRedisSerializer` over a purpose-built mapper:

1. Start from Boot's auto-configured `ObjectMapper` and **`.copy()` it** — activating default typing on the shared MVC mapper would corrupt every REST response.
2. `activateDefaultTyping(LaissezFaireSubTypeValidator, NON_FINAL, As.PROPERTY)` — embeds `@class` type hints on non-final types so the erased `PagedResponseDTO<UserPdfFileDTO>` graph round-trips into real DTOs. This must be done *before* constructing the serializer; skipping it fails **silently** (deserialized values come back as `LinkedHashMap`, and generics erasure means the controller still serializes them out correctly).
3. `GenericJackson2JsonRedisSerializer.registerNullValueSerializer(mapper, null)` — the documented contract for external mappers (defensive; moot while null caching is disabled).

The copied mapper already carries JavaTimeModule and ISO-8601 date writing from Boot, so the DTO's `LocalDateTime` fields serialize as readable strings. The no-arg `new GenericJackson2JsonRedisSerializer()` is **not** usable here: in spring-data-redis 3.2 its internal mapper lacks JavaTimeModule.

Two value-shape constraints follow from `NON_FINAL` typing:

- `UserPdfFileService.PdfData` is a **plain Lombok POJO, deliberately not a record** — records are implicitly final, get no `@class` hint, and would silently deserialize into a `LinkedHashMap` (a bare `byte[]` return would break the same way: it comes back as a Base64 `String`). The POJO's typed `byte[]` field Base64-round-trips correctly.
- The cached list methods return the plain `PagedResponseDTO` (never a `ResponseEntity`) — `ResponseEntity` has no default creator and is not reliably Jackson-deserializable as a cache value. The controller wraps it.

**`CacheErrorHandler`** (via `CachingConfigurer.errorHandler()`, the only method overridden) — every cache op failure (get/put/evict/clear) becomes a single `log.warn` with the cache name, key, and exception message. The interceptor treats a failed GET as a miss and moves on; a failed PUT just means the value isn't cached. Redis outages never propagate to the HTTP response.

## 4. API flow

### Read — `GET /pdf-files?page&size` → `getMyPdfFiles(page, size)`

1. `JwtRequestFilter` validates the Bearer token and sets `username` on the request-scoped `requestSecurityContext` bean (it sets **no userId** — the JWT carries only username + role).
2. Controller calls the service **through the Spring proxy**, so the `@Cacheable` interceptor runs. Its SpEL key is `@requestSecurityContext.username + ':' + #page + ':' + #size` — resolved on the request thread, costing **zero DB queries** (the same identity the rate limiter keys on).
3. Redis `GET user-pdf-files::<email>:<page>:<size>`:
   - **Hit** → the method body is skipped entirely — including `UserUtils.getCurrentUser()`'s user-by-email select and the page query.
   - **Miss** → body executes: resolve user → `findByUserId` ordered `createdAt DESC` → `.map(this::toDTO)` → `PagedResponseDTO.from(...)`; the DTO is PUT into Redis (TTL 5–10 min) and returned.
4. The controller wraps the DTO in `ResponseEntity.ok(...)`; the HTTP response body is unchanged.

### Read — `GET /pdf-files/{id}` → `getPdfFile(id)`

1. Same proxy mechanics, cache `user-pdf-file`, key `@requestSecurityContext.username + ':' + #id` — **per user**. That is the security linchpin: a hit skips `findOwnedPdfFile`/`UserUtils.checkOwnership` in the body, but an entry under `<email>:<id>` can only have been primed by that same authenticated user (or a `ROLE_ADMIN`, under the admin's own key) — one caller can never read another's cached bytes.
2. Miss → body executes: `findById` → `checkOwnership` → MinIO `getObject` → `PdfData(data, fileName)`, which is PUT into Redis and returned.
3. Thrown exceptions are **not cached**: `@Cacheable` stores nothing when the body throws, so 404 (unknown id) and 403 (not owned) responses never pollute Redis; repeat probes cost one Redis GET, never SQL or MinIO.
4. `unless = "#result.data.length > 5MB"` skips caching oversized payloads — a 20MB PDF becomes ~27MB of Base64 JSON in Redis, where loading it back is hardly cheaper than the localhost MinIO fetch. Big files simply always re-fetch.

### Writes — eviction

Every write that can change what either cache returns evicts **all entries** in **both** caches after the method completes successfully (`beforeInvocation = false` — a failed write leaves the caches alone):

| Service method | Triggering endpoint | Note |
|---|---|---|
| `UserPdfFileService.uploadPdfFiles` | `POST /pdf-files` | new ids can't have stale by-id entries, but both caches are evicted anyway — one uniform rule |
| `UserPdfFileService.deletePdfFile` | `DELETE /pdf-files/{id}` | `allEntries`, not a targeted `<owner>:<id>` key: an admin may delete another user's file, and the owner's cache key isn't derivable from the deleter's request context |
| `UserService.deleteUser` | `DELETE /users/{id}` | external writer; `@Transactional` — with `order = 0` the evict lands after commit. Without it, the deleted user's still-valid ≤15-min access token could keep reading cached PDF bytes (the DB existence check lives inside the cached body and is skipped on a hit) |

`allEntries = true` (a `SCAN`+`DEL` of `user-pdf-files::*` and `user-pdf-file::*`) is the right granularity for a personal app: per-page/per-id keys make targeted eviction impractical, and wiping every user's entries on any write costs one recomputation each.

## 5. Failure behavior

Redis is deliberately a **soft** dependency, in contrast to MinIO's hard startup dependency:

- **App boots without Redis.** The `RedisCacheManager` connects lazily; nothing touches Redis until the first cached call. (MinIO's bucket bootstrap runs eagerly and fails the context.)
- **Requests survive an outage.** With Redis stopped, a GET pays the 2s command timeout on the failed cache read, runs against Postgres/MinIO, then pays another 2s on the failed cache PUT — ~4s total, HTTP 200, with two `WARN` lines per request (`Redis GET failed ... falling through to DB`, `Redis PUT failed ...`). Writes behave the same (the evict's failure is logged and swallowed). The 2s timeout exists precisely because Lettuce's default is 60s per op.
- **Recovery is automatic.** Once Redis is reachable again, the next miss repopulates the key; stale entries from before the outage are bounded by the 5–10 min TTL.

## 6. Caveats & non-obvious behavior

- **Only the two PDF reads are cached.** Uploads/deletes are eviction sites only; no other domain (users, meetings, images) is cached.
- **Keys contain the user's email in cleartext** (`user-pdf-files::alice@mail.com:0:10`, `user-pdf-file::alice@mail.com:42`) — same sensitivity as the rate limiter's in-memory `user:<email>` keys.
- **A deleted user is stale-serveable for ≤ TTL in one window**: `getMyPdfFiles`'s body (which 404s a vanished user row) is skipped on a hit, so a just-deleted user with a live access token may see their cached list until the `deleteUser` evict (immediate) or TTL (backstop) clears it.
- **`LaissezFaireSubTypeValidator`** allows any subtype on cache deserialization. Safe only because the cache is writable solely by this app on localhost; an attacker who could write to Redis could craft gadget payloads.
- **Direct DB/MinIO edits bypass eviction** — rows changed outside the app (SQL console) stay stale in the cache until the 5–10 min TTL expires.
- **The Redis mapper writes `content` as `java.util.Collections$UnmodifiableRandomAccessList`** (`Page.map` yields an immutable list) — an artifact of default typing, harmless on round-trip.
- **Big files (>5MB) are never cached** (the `unless` guard) — repeated downloads of those always hit MinIO.

## Quick manual check

```bash
docker compose up -d                                  # myrooms-redis healthy; redis-cli ping -> PONG
mvn spring-boot:run                                   # boots even with Redis empty/stopped
TOKEN=$(curl -s -X POST localhost:8083/auth/login -H 'Content-Type: application/json' \
       -d '{"email":"...","password":"..."}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s "localhost:8083/pdf-files?page=0&size=10" -H "Authorization: Bearer $TOKEN"   # miss: SQL logged
sleep 1
curl -s "localhost:8083/pdf-files?page=0&size=10" -H "Authorization: Bearer $TOKEN"   # hit: no SQL
curl -s localhost:8083/pdf-files/1 -H "Authorization: Bearer $TOKEN" -o /dev/null     # by-id miss
sleep 1
curl -s localhost:8083/pdf-files/1 -H "Authorization: Bearer $TOKEN" -o /dev/null     # by-id hit
docker exec myrooms-redis redis-cli KEYS 'user-pdf-file*'   # both caches' keys (TTL <= 600)
docker exec myrooms-redis redis-cli TTL 'user-pdf-files::<email>:0:10'                # <= 600
curl -s -X DELETE localhost:8083/pdf-files/1 -H "Authorization: Bearer $TOKEN"
docker exec myrooms-redis redis-cli KEYS 'user-pdf-file*'   # empty — both caches evicted
docker compose stop redis                              # GETs still 200 from the DB (~4s, WARN logs)
```

(Mind the 3 req/s rate limiter — keep ~0.5s between calls.)
