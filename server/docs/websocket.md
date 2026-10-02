# WebSocket Notifications in the Backend

The backend pushes notifications to the browser over a **raw WebSocket** — no STOMP, no SockJS, no client→server messages. It is the only server-initiated channel in the app (everything else is request/response REST). The pieces, all in the `websocket/` package except the DTO:

- `websocket/WebSocketConfiguration` — `@EnableWebSocket`; registers the handler at `/ws/notifications` with the auth interceptor and an origin allowlist.
- `websocket/WebSocketAuthInterceptor` — the real auth gate: a `HandshakeInterceptor` that validates the JWT query param (the security chain's `permitAll` for `/ws/**` delegates to it).
- `websocket/NotificationWebSocketHandler` — holds every open session in a `CopyOnWriteArraySet`; `broadcast()` sends one JSON text frame to each.
- `websocket/NotificationScheduler` — `@Scheduled` trigger that fires the broadcast on a fixed interval.
- `dto/NotificationDTO` — the payload: `record(String message, String timestamp)`.

```
frontend                                              backend :8083
   │                                                        │
   │  GET /ws/notifications?token=<accessJWT>   (upgrade)   │
   │───────────────────────────────────────────────────────>│  JwtRequestFilter: no Bearer header → pass-through
   │                                                        │  RateLimitFilter: one ip:<remoteAddr> slot
   │                                                        │  /ws/** permitAll → Origin check (app.client.url)
   │                                                        │  WebSocketAuthInterceptor.beforeHandshake:
   │                                                        │    token → username → typ=access → UserDetails
   │                                                        │    → signature + expiry      ✗ any failure → 401
   │<───────────────────────────────────────────────────────│  101 Switching Protocols
   │                                                        │
   │          session registered in NotificationWebSocketHandler.sessions
   │                                                        │
   │                                                        │   NotificationScheduler  ⏱ every interval-ms
   │                                                        │     │ new NotificationDTO(message, Instant.now().toString())
   │                                                        │     ▼
   │                                                        │   handler.broadcast(json) — one frame per open session
   │<───────────────────────────────────────────────────────│  {"message":"Reminder: please review your assets.",
   │                                                        │   "timestamp":"2026-09-29T08:30:00Z"}
```

## 1. Message contract

- **URL**: `ws://localhost:8083/ws/notifications?token=<accessJWT>` (`wss://` in production).
- **Direction**: one-way, server → client. Inbound frames land on the `TextWebSocketHandler` default no-op `handleTextMessage` and are ignored — there is no request/ack/subscribe protocol.
- **Frame** (one text frame per interval, to every connected client):

```json
{"message": "Reminder: please review your assets.", "timestamp": "2026-09-29T08:30:00Z"}
```

`timestamp` is deliberately a `String` — ISO-8601 UTC via `Instant.toString()` — so any `ObjectMapper` serializes the record without JavaTimeModule concerns.

## 2. Configuration

`pom.xml` adds `spring-boot-starter-websocket` (the raw WS API; no STOMP broker). `@EnableScheduling` sits on `AssetManagerApplication` next to `@EnableCaching`.

`application.properties`:

| Property | Value | Purpose |
|---|---|---|
| `app.notification.interval-ms` | `1800000` (30 min) | Broadcast cadence — `@Scheduled(fixedRateString)` on `NotificationScheduler.broadcastReminder`; same default lives in the annotation, so the property is optional |
| `app.notification.message` | `Reminder: please review your assets.` | Frame text — `@Value` on the scheduler; same default in the annotation |
| `app.client.url` | `http://localhost:4200` | Handshake origin allowlist — comma-separated exact origins, trailing `/*` tolerated (identical parsing to the REST CORS bean) |

For a demo run, drop the interval (`app.notification.interval-ms=15000`) instead of waiting 30 minutes.

## 3. Connect: handshake & auth flow

**Why a query param?** The browser WebSocket API cannot set request headers, so the usual `Authorization: Bearer` is impossible on the handshake GET — the access JWT travels as `?token=` instead. Accepted trade-off: the token may appear in access/proxy logs. (The refresh cookie is no alternative — `Path=/auth` means it never rides a `/ws/...` handshake.)

The handshake is a plain GET through the security chain before the upgrade:

1. `JwtRequestFilter` sees no Bearer header and passes the request through unauthenticated.
2. `RateLimitFilter` charges **one slot** in the `ip:<remoteAddr>` bucket (no identity yet).
3. `/ws/**` matches `permitAll` in `WebSecurityConfiguration` — *not* because the socket is public, but because `WebSocketAuthInterceptor` is about to do the real check.
4. Spring enforces the `Origin` header against `setAllowedOrigins(...)` derived from `app.client.url` — the WS equivalent of CORS; never `*`, because the handshake carries a credential (the JWT).
5. `WebSocketAuthInterceptor.beforeHandshake` replays the `JwtRequestFilter` validation sequence:

| Step | Failure → 401 reason |
|---|---|
| `token` query param missing/blank | "Missing token" |
| `jwtUtil.extractUsername(token)` (subject) | parse failure → "Invalid token" |
| `!jwtUtil.isAccessToken(token)` (`typ=access` claim — refresh tokens rejected) | "Invalid token" |
| `userDetailsService.loadUserByUsername(username)` | unknown user → "Invalid token" |
| `!jwtUtil.validateToken(token, userDetails)` (username match + signature + expiry) | "Invalid token" / `ExpiredJwtException` → "Token expired" |

`reject()` sets HTTP 401 on the handshake response and returns `false` — the browser just sees a failed connection (`onclose`, no error body); the reason only appears in the backend's debug log.

Once the upgrade completes (101), **frames never traverse the servlet/security chain** — no filter, no rate limit, no per-frame auth.

## 4. Push: how the backend sends messages

`NotificationScheduler.broadcastReminder()` fires every `interval-ms` (a fixed rate from app start, not aligned to connects), logs the session count, and calls `handler.broadcast(new NotificationDTO(message, Instant.now().toString()))`.

`NotificationWebSocketHandler.broadcast(...)`:

1. **No sessions** → return immediately (cheap no-op; the scheduler fires regardless).
2. Serialize the DTO **once** with the Spring-managed `ObjectMapper`; a serialization failure logs and aborts the whole round.
3. For each session in the `CopyOnWriteArraySet`: closed sessions are skipped and lazily evicted; each send is wrapped in `synchronized (session)` so concurrent sends can't interleave on a session.
4. A session whose `sendMessage` throws `IOException` is evicted and best-effort closed — one broken client never blocks the rest of the broadcast.

Sessions are added in `afterConnectionEstablished` and removed in `afterConnectionClosed` (plus the lazy evictions above). The broadcast is **global**: every connected user receives the same frame — there is no per-user resolution, which is also why the scheduler needs no request-scoped context.

## 5. Client integration

Both frontends (Angular `frontend/src/app/service/notification.service.ts`, React/Zustand `react-frontend/src/app/store/notification-store.ts`) implement the same contract, deriving the URL from `apiUrl` so the host is configured in one place:

```ts
const wsUrl = `${environment.apiUrl.replace(/^http/, 'ws')}/ws/notifications`;
const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);

socket.onmessage = (event) => {
  const n = JSON.parse(event.data);   // { message: string, timestamp: string } — guard both fields
  // append to notification list / store
};
```

Shared behavior in both clients:

- Connection lifecycle follows the auth session (Angular: an `effect()` on `sessionActive()`; React: `initNotificationSync()` called once from `main.tsx`, outside React so StrictMode can't double-connect).
- Reconnect with exponential backoff capped at 30 s; the access token is refreshed first when it has expired before reconnecting.
- Last `MAX_HISTORY = 20` notifications kept newest-first, persisted to localStorage (`asset-manager.notifications`).
- A socket left hidden ≥ 60 s is recycled on `visibilitychange`/`online` (mobile browsers freeze tabs).

## 6. Caveats & non-obvious behavior

- **`permitAll` on `/ws/**` is not public access** — reject the handshake and nothing else happens; `WebSocketAuthInterceptor` is the gate.
- **Handshake auth is one-time.** An open connection outlives the 15-minute access token; logout / token revocation does not kill an established socket.
- **JWT in the query string** may surface in access logs — the documented trade-off for the browser API's no-headers limitation.
- **Rate limiting covers the handshake only** (one `ip:` slot per upgrade GET); frames bypass the chain entirely.
- **Broadcast is global** — no per-user targeting exists today; adding it means resolving the user at handshake (e.g. stashing the `UserDetails` in the session attributes map `beforeHandshake` hands to the handler).
- `sessionCount()` is package-private — used by the scheduler's log line and the tests, not an API.
- **Test coverage**: only `NotificationWebSocketHandler` has tests (`src/test/.../websocket/NotificationWebSocketHandlerTest.java` — broadcast to open sessions, skip+evict closed, evict+close a failing session, zero-session no-op). Interceptor, configuration, and scheduler are untested.
- **No SockJS/STOMP fallback** — needs raw WebSocket end-to-end; fine for modern browsers, but a proxy that blocks WS upgrades breaks the channel silently (clients just keep retrying).

## Quick manual check

```bash
docker compose up -d                                  # Postgres (+ Redis for the passbook cache)
# fast cadence for the demo (default is 30 min):
mvn spring-boot:run -Dspring-boot.run.arguments=--app.notification.interval-ms=15000

TOKEN=$(curl -s -X POST localhost:8083/auth/login -H 'Content-Type: application/json' \
       -d '{"email":"...","password":"..."}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

npx wscat -c "ws://localhost:8083/ws/notifications?token=$TOKEN"
# connected (press Ctrl+C to quit) — within interval-ms a frame arrives:
# < {"message":"Reminder: please review your assets.","timestamp":"2026-09-29T08:30:00Z"}

npx wscat -c "ws://localhost:8083/ws/notifications?token=broken"   # rejected: 401 handshake failure
```

(Mind the 3 req/s rate limiter — the handshake GET costs one `ip:` slot, so keep ~0.5s between connects.)
