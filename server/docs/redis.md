# Redis in the Backend

Redis is the Spring Cache backing store used for the two savings-passbook read paths: **the paged list** (`GET /savings-passbooks`) and **the by-ID GET** (`GET /savings-passbooks/{id}`), both guarded against cache penetration by in-memory Bloom filters. No code talks to Redis directly — everything goes through Spring's cache abstraction (`@Cacheable` / `@CacheEvict`) on a `RedisCacheManager`. The pieces:

- `AssetManagerApplication` — `@EnableCaching(order = 0)` switches proxy-based caching on.
- `configuration/RedisCacheConfig` — the only class that touches Redis APIs: the `RedisCacheManager` bean (TTL + serializer) and a `CacheErrorHandler` for outages.
- `SavingsPassbookService` — `@Cacheable` on the list and by-ID methods, `@CacheEvict` (both caches) on its four write methods.
- `AdditionalDepositService.deposit` and `UserService.deleteUser` — `@CacheEvict` (both caches) for writes that mutate passbooks outside the passbook endpoints.
- `services/asset/SavingsPassbookBloomFilter` — the cache-penetration guard (see §6); pure Java/Guava, no Redis involvement.

The split of responsibilities:

- **PostgreSQL** stays the source of truth; every write path goes to the DB first and only then evicts cache entries.
- **Redis** holds time-limited (5–10 min, randomized once per startup) copies of already-computed pages and by-ID DTOs, keyed per user. Losing it costs nothing but a recomputation.

```
browser ──JWT──> frontend ──> backend :8083   GET /savings-passbooks?page=0&size=10
                                              │  JwtRequestFilter → requestSecurityContext.username
                                              ▼
                                   SavingsPassbookController
                                              │  call routed through the caching proxy
                                              ▼
                        cache interceptor — key "<username>:<page>:<size>"
                                              │
                                   Redis GET savings-passbooks::<email>:<page>:<size>
                                     ┌─ hit ──┴──── miss ──────────────────────────┐
                                     │        service method body runs:            │
                                return the    UserUtils.getCurrentUser()   (select) │
                                cached DTO    bloom.mightHavePassbooks(userId)?    │
                                (no SQL)      ├─ no → PagedResponseDTO.empty (no   │
                                     │        │        SQL, still PUT with TTL)   │
                                     │        └─ yes → findByUserId (select)      │
                                     │                 .map(toDTO) → from(...)   │
                                     │        then PUT the result into Redis (TTL 5-10m)
                                     ▼                        ▼
                                   200 OK                   200 OK
```

## 1. Infrastructure (docker-compose.yml)

```yaml
redis:
  image: redis:7-alpine        # official library/redis image (still on Docker Hub)
  container_name: myassets-redis
  restart: always
  ports: ["6378:6379"]
  volumes: [redis_data:/data]
  healthcheck: ["CMD", "redis-cli", "ping"]
```

- **6378** is the only surface; unauthenticated, matching the dev posture of the exposed Postgres/MinIO credentials.
- Data persists in the `redis_data` named volume (default periodic RDB snapshots — harmless for a cache).
- **No bootstrap step**: unlike MinIO's bucket creation, nothing is created at startup. The cache starts empty and fills on demand; `docker compose up -d` alone is enough.

## 2. Application configuration

`pom.xml` adds two parent-managed starters: `spring-boot-starter-cache` (the annotation model) and `spring-boot-starter-data-redis` (Lettuce client + `spring.data.redis.*` support).

`application.properties`:

| Property | Value                | Purpose |
|---|----------------------|---|
| `spring.data.redis.host` / `port` | `localhost` / `6378` | Point at the compose service (explicit though they match defaults) |
| `spring.data.redis.timeout` | `2s`                 | Lettuce **command timeout** — caps how long any cache op may stall when Redis is unreachable |
| `spring.cache.type` | `redis`              | Inert once the custom `CacheManager` bean exists (Boot's auto-config backs off via `@ConditionalOnMissingBean`); kept as documentation of the provider choice |
| `app.cache.bloom.expected-insertions` | `100000`             | Capacity hint for each Bloom filter (bits are sized from it; ~120 KB per filter at this setting) |
| `app.cache.bloom.fpp` | `0.01`               | Target false-positive probability — 1% of unknown ids/users cost one wasted DB hit |

`@EnableCaching(order = 0)` on `AssetManagerApplication` does two things: enables the cache interceptors, and pins them **outermost** relative to `@Transactional` (which defaults to lowest precedence). Effect: `@CacheEvict` on a transactional writer fires *after* the DB commit, so a concurrent reader can't refill the cache with pre-commit data.

## 3. Cache configuration — `configuration/RedisCacheConfig`

The class name is deliberately `RedisCacheConfig`, not `RedisCacheConfiguration` — its body imports `org.springframework.data.redis.cache.RedisCacheConfiguration` (TTL/serializer builder), which would collide with the enclosing class's simple name.

**`RedisCacheManager` bean** — a single default cache config:

- `entryTtl(Duration.ofMinutes(ThreadLocalRandom.nextInt(5, 11)))` — every entry expires 5–10 minutes after write (one random value drawn per startup, shared by all entries that boot writes; slight TTL spread across restarts). TTL is the staleness bound if an eviction is ever missed (e.g. rows edited directly in the DB).
- `disableCachingNullValues()` — neither cached method returns null; nothing null is stored.
- No per-cache overrides; both caches are created on demand: `AssetConstants.CACHE_SAVINGS_PASSBOOKS` = `"savings-passbooks"` (paged lists, key `<email>:<page>:<size>`) and `AssetConstants.CACHE_SAVINGS_PASSBOOK` = `"savings-passbook"` (by-ID entries, key `<email>:<id>`) — the singular/plural pair is why every annotation site uses the constants, never string literals.

**Serialization** — `GenericJackson2JsonRedisSerializer` over a purpose-built mapper:

1. Start from Boot's auto-configured `ObjectMapper` and **`.copy()` it** — activating default typing on the shared MVC mapper would corrupt every REST response.
2. `activateDefaultTyping(LaissezFaireSubTypeValidator, NON_FINAL, As.PROPERTY)` — embeds `@class` type hints on non-final types so the erased `PagedResponseDTO<SavingsPassbookDTO>` graph round-trips into real DTOs. This must be done *before* constructing the serializer; skipping it fails **silently** (deserialized values come back as `LinkedHashMap`, and generics erasure means the controller still serializes them out correctly).
3. `GenericJackson2JsonRedisSerializer.registerNullValueSerializer(mapper, null)` — the documented contract for external mappers (defensive; moot while null caching is disabled).

The copied mapper already carries JavaTimeModule and ISO-8601 date writing from Boot, so `LocalDateTime` and `BigDecimal` fields serialize as readable strings. The no-arg `new GenericJackson2JsonRedisSerializer()` is **not** usable here: in spring-data-redis 3.2 its internal mapper lacks JavaTimeModule.

**`CacheErrorHandler`** (via `CachingConfigurer.errorHandler()`, the only method overridden) — every cache op failure (get/put/evict/clear) becomes a single `log.warn` with the cache name, key, and exception message. The interceptor treats a failed GET as a miss and moves on; a failed PUT just means the value isn't cached. Redis outages never propagate to the HTTP response.

## 4. API flow

### Read — `GET /savings-passbooks?page&size` → `getMySavingsPassbooks(page, size)`

1. `JwtRequestFilter` validates the Bearer token and sets `username` on the request-scoped `requestSecurityContext` bean (it sets **no userId** — the JWT carries only username + role).
2. Controller calls the service **through the Spring proxy**, so the `@Cacheable` interceptor runs. Its SpEL key is `@requestSecurityContext.username + ':' + #page + ':' + #size` — resolved on the request thread, costing **zero DB queries** (the same identity the rate limiter keys on).
3. Redis `GET savings-passbooks::<email>:<page>:<size>`:
   - **Hit** → the method body is skipped entirely — including `UserUtils.getCurrentUser()`'s user-by-email select and the page query. Measured with `show-sql=true`: a miss runs 3 selects (JWT filter's `loadUserByUsername`, `getCurrentUser`, page query), a hit runs only the JWT filter's 1.
   - **Miss** → body executes: resolve user → **Bloom check** `mightHavePassbooks(userId)` (§6) → if the filter says the user owns no passbook, return `PagedResponseDTO.empty(page, size)` with **no SQL** (the empty page is still PUT into Redis — intended, see §6); otherwise `findByUserId` ordered by `COALESCE(maturityDate, withdrawalDate) DESC` → `.map(this::toDTO)` → `PagedResponseDTO.from(...)`; the DTO is PUT into Redis (TTL 5–10 min) and returned.
4. The controller wraps the DTO in `ResponseEntity.ok(...)` — the service returns the plain `PagedResponseDTO` (not a `ResponseEntity`) because `ResponseEntity` has no default creator and is not reliably Jackson-deserializable as a cache value. The HTTP response body is unchanged.

### Read — `GET /savings-passbooks/{id}` → `getSavingsPassbook(id)`

1. Same proxy mechanics, cache `savings-passbook`, key `@requestSecurityContext.username + ':' + #id` — **per user**, so one caller can never read another's cached DTO (the first load for *this* user still ran `UserUtils.checkOwnership` inside the body).
2. Miss → body executes: **Bloom check** `mightContainPassbook(id)` — a filter miss throws the standard `NotFoundException` without SQL (the whole point: probing random ids can't hammer Postgres). A filter pass → `findById` → `checkOwnership` → `toDTO`.
3. Thrown exceptions are **not cached**: `@Cacheable` stores nothing when the body throws, so 404 (unknown id) and 403 (not owned) responses never pollute Redis; repeat probes cost one Redis GET + one in-memory Bloom check, never SQL.
4. The service returns the plain `SavingsPassbookDTO` for the same `ResponseEntity`-round-trip reason as the list; the controller wraps it in `ResponseEntity.ok(...)`.

### Writes — eviction

Every write that can change what either cache returns evicts **all entries** in **both** caches after the method completes successfully (`beforeInvocation = false` — a failed write leaves the caches alone):

| Service method | Triggering endpoint | Note |
|---|---|---|
| `SavingsPassbookService.createSavingsPassbook` | `POST /savings-passbooks` | also inserts the initial `AdditionalDeposit` and feeds both Bloom filters with the new id + owner |
| `SavingsPassbookService.updateSavingsPassbook` | `PUT /savings-passbooks/{id}` | |
| `SavingsPassbookService.deleteSavingsPassbook` | `DELETE /savings-passbooks/{id}` | |
| `SavingsPassbookService.deleteSavingsPassbooks` | `DELETE /savings-passbooks/bulk` | `@Transactional` — with `order = 0` the evict lands after commit |
| `AdditionalDepositService.deposit` | `POST /additional-deposits` | sender-identifies-themselves flow: the passbook **owner may differ from the caller**, and their username isn't derivable from the request context — hence `allEntries` instead of a per-user key |
| `UserService.deleteUser` | `DELETE /users/{id}` | user delete cascades their assets |

`allEntries = true` (a `SCAN`+`DEL` of `savings-passbooks::*` and `savings-passbook::*`) is the right granularity for a personal app: per-page/per-id keys make targeted eviction impractical, and wiping every user's entries on any write costs one recomputation each.

## 5. Failure behavior

Redis is deliberately a **soft** dependency, in contrast to MinIO's hard startup dependency:

- **App boots without Redis.** The `RedisCacheManager` connects lazily; nothing touches Redis until the first cached call. (MinIO's bucket bootstrap runs eagerly and fails the context.)
- **Requests survive an outage.** With Redis stopped, a GET pays the 2s command timeout on the failed cache read, runs against Postgres, then pays another 2s on the failed cache PUT — ~4s total, HTTP 200, with two `WARN` lines per request (`Redis GET failed ... falling through to DB`, `Redis PUT failed ...`). Writes behave the same (the evict's failure is logged and swallowed). The 2s timeout exists precisely because Lettuce's default is 60s per op.
- **Recovery is automatic.** Once Redis is reachable again, the next miss repopulates the key; stale entries from before the outage are bounded by the 5–10 min TTL.

## 6. Bloom-filter penetration guard — `services/asset/SavingsPassbookBloomFilter`

**Cache penetration** = repeated cache misses for data that doesn't exist (random ids, out-of-range pages, zero-data users): every request costs a DB query and the cache can never help. The guard is two in-memory Guava `BloomFilter<Long>`s (already on the classpath — Guava 23.0):

- `passbookIds` — every passbook id that ever existed → guards `GET /savings-passbooks/{id}`.
- `ownerUserIds` — user ids owning ≥ 1 passbook → guards `GET /savings-passbooks` (a user the filter says owns nothing gets the empty page with no SQL).

Layering is **Cache → Bloom → DB**: both Bloom checks run *inside* the cached method bodies, so a cache hit pays nothing, and the DB is reached only when both Redis and the filter say "maybe".

Semantics, in order of importance:

- **Fail-open.** A `volatile boolean ready` gates both checks: until the startup rebuild succeeds, every `mightContain*` answers `true` (pass-through, mirroring the Redis degrade-to-DB handler). An empty-but-authoritative filter would 404 all real data — the one catastrophic state — so a failed rebuild drops back to pass-through mode instead.
- **No false negatives for existing data.** `ApplicationRunner.run` rebuilds both filters from two scalar repo queries (`findAllPassbookIds`, `findDistinctOwnerUserIds`) at startup; `createSavingsPassbook` `put`s the new id + owner right after `save`. **Never removes on delete** — a stale bit is a false *positive* (one wasted DB hit, correct result), never a false negative.
- **Rebuild is additive, never a swap.** The web server accepts requests before `ApplicationRunner`s execute, so `rebuild()` PUTs into the existing filter instances; swapping in fresh ones built from a pre-runner snapshot could discard a racing create's `put`. Guava `put` is idempotent, so additive convergence costs nothing.
- **Accepted race:** Guava's CAS bit-set means a concurrent `put`/`mightContain` of the *same* element can transiently read absent — but puts happen only on create, and the racing reader's outcome equals today's behavior (the row isn't queryable pre-commit anyway → 404 either way).
- **The paged-list empty short-circuit is cached by design.** The empty `PagedResponseDTO` is a normal (non-null) return value, so it lands in Redis under the caller's key: repeated probes of the same `(page, size)` become cache hits, and pollution is bounded by the 5–10 min TTL × the 3 req/s rate limiter. `PagedResponseDTO.empty(page, size)` builds through `PageImpl` so the response is byte-identical to a real empty DB page (`first=false` for page > 0, same invalid-paging `IllegalArgumentException` → 400).
- **Memory:** ~120 KB per filter at the default 100k insertions / 1% fpp — ~240 KB total.
- The distributed Redis-backed alternative (Redisson `RBloomFilter`) — shared across app instances, surviving restarts — is documented as a migration path in `docs/redisson-bloom-filter.md`, deliberately not implemented.

## 7. Caveats & non-obvious behavior

- **Only the two passbook reads are cached.** `GET /savings-passbooks/search` always hits Postgres — it was left out of scope deliberately.
- **Keys contain the user's email in cleartext** (`savings-passbooks::alice@mail.com:0:10`, `savings-passbook::alice@mail.com:42`) — same sensitivity as the rate limiter's in-memory `user:<email>` keys.
- **`LaissezFaireSubTypeValidator`** allows any subtype on cache deserialization. Safe only because the cache is writable solely by this app on localhost; an attacker who could write to Redis could craft gadget payloads.
- **`UserService.deleteUser`'s evict is currently unreachable in practice**: the endpoint itself fails with a `refresh_tokens` FK violation for any user who still has token rows (pre-existing bug, unrelated to Redis) — change-password first to revoke tokens, then delete succeeds.
- **Direct DB edits bypass eviction *and* the Bloom filters** — rows changed outside the app (SQL console) stay stale in the cache until the 5–10 min TTL expires, and a row inserted directly in SQL isn't in the Bloom filter, so its id 404s until the next restart rebuilds the filters.
- **Bloom false positives cost one DB hit** and then behave normally (404 from `findById`, or the cached empty page for the list) — 1% of unknown ids at the default fpp.
- **Requests racing startup see pass-through, not blocks**: the web server accepts traffic before the `ApplicationRunner` finishes, and a failed load logs one `WARN` and leaves the filters answering `true` (DB-backed) — the guard can delay, never deny.
- The Redis mapper writes `content` as `java.util.Collections$UnmodifiableRandomAccessList` (`Page.map` yields an immutable list) — an artifact of default typing, harmless on round-trip. (`PagedResponseDTO.empty` deliberately uses `ArrayList`, a proven-round-trippable type.)

## Quick manual check

```bash
docker compose up -d                                  # myassets-redis healthy; redis-cli ping -> PONG
mvn spring-boot:run                                   # boots even with Redis empty/stopped
TOKEN=$(curl -s -X POST localhost:8083/auth/login -H 'Content-Type: application/json' \
       -d '{"email":"...","password":"..."}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s "localhost:8083/savings-passbooks?page=0&size=10" -H "Authorization: Bearer $TOKEN"   # miss: SQL logged
sleep 1
curl -s "localhost:8083/savings-passbooks?page=0&size=10" -H "Authorization: Bearer $TOKEN"   # hit: no SQL
curl -s localhost:8083/savings-passbooks/1 -H "Authorization: Bearer $TOKEN"                  # by-id miss: SQL logged
sleep 1
curl -s localhost:8083/savings-passbooks/1 -H "Authorization: Bearer $TOKEN"                  # by-id hit: no SQL
curl -s -w '\n%{http_code}\n' localhost:8083/savings-passbooks/999999 \
     -H "Authorization: Bearer $TOKEN"          # 404, NO SQL logged — Bloom-miss short-circuit
docker exec myassets-redis redis-cli KEYS 'savings-passbook*'   # both caches' keys (TTL <= 600)
docker exec myassets-redis redis-cli TTL 'savings-passbooks::<email>:0:10'                    # <= 600
curl -s -X POST localhost:8083/savings-passbooks -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"principalAmount":1000,"interestRate":5.5,"maturityDate":"2027-01-01T00:00:00"}'
docker exec myassets-redis redis-cli KEYS 'savings-passbook*'   # empty — both caches evicted
curl -s localhost:8083/savings-passbooks/<newId> -H "Authorization: Bearer $TOKEN"  # readable immediately (Bloom add-on-create)
docker compose stop redis                              # GETs still 200 from the DB (~4s, WARN logs)
```

(Mind the 3 req/s rate limiter — keep ~0.5s between calls.)
