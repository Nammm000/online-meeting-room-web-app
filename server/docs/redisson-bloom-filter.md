# Redisson RBloomFilter — the Distributed Alternative (NOT implemented)

This doc describes the Redis-backed Bloom filter we would use **if this app ever runs more than one instance**. It is a documented migration path only — no code in this repo uses Redisson, and no dependency is added. The live implementation is the in-memory Guava guard in `services/asset/SavingsPassbookBloomFilter` (see `docs/redis.md` §6).

The one-paragraph version: Guava's `BloomFilter` lives in one JVM's heap and is rebuilt from Postgres at every boot, so N app replicas each carry a private copy that only sees its own process's `put` calls — replica A creates a passbook, replica B's filter never hears about it, and B serves false negatives (404 for a real id) until it restarts. Redisson's `RBloomFilter` moves the bit array into a single Redis key that every replica shares, which fixes exactly that.

```
             ┌─ replica A ─┐                 ┌─ replica B ─┐
             │ app + guard │                 │ app + guard │
             └──────┬──────┘                 └──────┬──────┘
                    │ add(id) / contains(id)        │ contains(id)
                    │  (Redisson client, per-check network hop)
                    ▼                                 ▼
             ┌─────────────────────────────────────────────┐
             │ Redis: one string key = the shared bit array │
             │ SETBIT / GETBIT executed inside Lua scripts  │
             └─────────────────────────────────────────────┘
```

## 1. What `RBloomFilter` is

`org.redisson.api.RBloomFilter<V>` — Redisson's Redis-backed probabilistic set. Same contract as Guava's (`add` / `contains`, false positives possible, false negatives never, no per-element removal), but the bit array is a Redis string key addressed with `SETBIT`/`GETBIT`, so membership state is **shared by every client of that Redis** and **survives app restarts** (contrast: the Guava filter is empty after every boot until the `ApplicationRunner` rebuild finishes).

## 2. Mechanics

- `tryInit(expectedInsertions, falseProbability)` sizes the bit array and hash-function count; it runs as a Lua script so concurrent initializers can't race (it's idempotent — returns `false` if already initialized with different parameters).
- Hashing is Redisson's "piecewise" scheme: one 128-bit MurmurHash3 pass over the encoded value, then k index computations from slices of it — same trick as Guava, minus the second hash function.
- `add`/`contains` each evaluate their bit indices inside a Lua script on the Redis side, so a membership check is one network round trip.

## 3. Dependency & client coexistence

Two ways to bring Redisson in, and they are very different in blast radius:

- **Plain `redisson` artifact + a hand-built `RedissonClient` bean** (`Redisson.create(config)` pointing at `localhost:6379`). This coexists with the existing Lettuce client — two clients, one Redis; watch connection counts. Keeps Spring's cache abstraction (and `RedisCacheConfig`) untouched.
- **`redisson-spring-boot-starter`** — auto-configures Redisson *and* tries to take over caching/redisson-based `RedissonSpringCacheManager`. That would fight the existing `RedisCacheManager` bean. Only for a full-scope switch; out of the question for just the Bloom filter.

## 4. API surface (vs the Guava guard)

| Guava (today) | Redisson equivalent |
|---|---|
| `BloomFilter.create(funnel, n, p)` | `bloomFilter.tryInit(n, p)` on `redissonClient.getBloomFilter("name")` |
| `put(v)` | `add(v)` |
| `mightContain(v)` | `contains(v)` |
| `expectedFpp()` / `approximateElementCount()` | `getFalseProbability()`, `getExpectedInsertions()`, `count()` |
| — (rebuild = new instance) | `delete()` then `tryInit` + re-`add` (rebuild = drop the key) |
| dies with the JVM | `expire(ttl)` works — it's a plain Redis key |

Values are encoded with a Redisson codec — `LongCodec` for our `Long` ids/user ids (`StringCodec` if we ever key by email instead).

## 5. Persistence & rebuild semantics

- The bits live in Redis (`redis_data` volume), so an app restart does **not** lose them — the startup `ApplicationRunner` rebuild becomes optional rather than mandatory.
- Like Guava there is **no per-element removal**: deletes still leave false positives (safe, one wasted DB hit). A full rebuild is `delete()` → `tryInit` → re-`add` everything — cheap to run periodically if direct-to-DB writes ever accumulate stale positives.
- With `expire()` the filter can self-destruct on a schedule, forcing the next init to re-seed from the source of truth — the Redis equivalent of "restart to rebuild".

## 6. Trade-offs vs the in-memory Guava filter

- **Per-check network hop.** Guava answers in nanoseconds from heap; Redisson costs a Redis RTT on every guarded miss. In our layering (Cache → Bloom → DB) that's fine — it replaces a Postgres query, which is orders of magnitude dearer — but it's no longer free.
- **Heap → Redis memory.** ~120 KB per filter at today's sizing; trivial either way.
- **Redisson becomes a hard dependency unless wrapped.** Today Redis is deliberately *soft* (`RedisCacheConfig`'s error handler degrades to DB, and the Guava filter doesn't care about Redis at all). An `RBloomFilter.contains` throws when Redis is down, so the fail-open try/catch currently living in `rebuild()` must move into every `mightContain*` call to preserve the same guarantee: **the guard can delay, never deny.**
- **The actual win is multi-instance correctness** (one shared filter instead of N drifting copies). With a single instance there is no win — only cost.

## 7. Migration path (when a second instance ever appears)

`SavingsPassbookBloomFilter`'s four public methods (`mightContainPassbook`, `mightHavePassbooks`, `addPassbook`, `addUserWithPassbook`) are the seam — the service knows nothing about the implementation:

1. Add the plain `redisson` dependency and a `RedissonClient` bean over the existing `spring.data.redis.*` properties.
2. Inside the component, replace the two Guava filters with `RBloomFilter<Long>` handles (`getBloomFilter("bloom:passbook-ids")`, `getBloomFilter("bloom:owner-user-ids")`, `LongCodec`).
3. `tryInit(expectedInsertions, fpp)` at startup (parameters move to `app.cache.bloom.redisson.*`); the full-table re-seed becomes an optional periodic/triggered job instead of a boot requirement.
4. Wrap every `contains` in the same fail-open catch that `rebuild()` has today, so a Redisson outage degrades to DB instead of 404ing real data.
5. Keep the `ready`/pass-through semantics for the init-not-yet-run window; drop the "additive rebuild, never swap" concern — with a shared key there is no per-JVM instance to swap.

## 8. Why not now

Single instance, so the drift problem `RBloomFilter` solves doesn't exist; the project is deliberately not accumulating new dependencies for unused capability; and Redis is kept a soft dependency — a Redisson client would add a second Redis-speaking stack that must be taught the same fail-open discipline the rest of the cache already follows.
