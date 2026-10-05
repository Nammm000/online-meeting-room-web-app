# coturn (TURN/STUN relay)

coturn is the **NAT-traversal** piece of the media plane — the one service shared by **both** media PeerConnections (LiveKit video, Janus audio) and the **only media container the Spring control plane never talks to**: no `app.turn.*` properties exist, no credentials are minted anywhere in the backend, and nothing in `MediaCredentialsDTO` carries TURN data. It is pure infrastructure, deployed and healthy in docker-compose, currently **awaiting client wiring** (§4). Design role: `docs/meeting-media-architecture.md` §4.4.

## 1. What TURN does here

WebRTC peers find each other via ICE candidate exchange, in increasing desperation:

| Candidate | Source | Works until |
|---|---|---|
| `host` | local interface addresses | same LAN / no NAT |
| `srflx` | **STUN** — "what does my public address look like?" | cone NAT (most home routers) |
| `relay` | **TURN** — "route everything through this server" | always — the only option behind symmetric NAT (common on mobile/carrier/enterprise networks) |

```
  browser ──►┐                        ┌──► LiveKit :7880 (video PC)
             │  coturn :3478          │
             └──► all media via relay ┘──► Janus :8188 (audio PC)
                  61000-61100/udp relay ports
```

- A relayed client costs the coturn box ~2× transit (in + out) — the worst case everyone-relayed figure in `docs/meeting-media-architecture.md` §8. For this app's sparse-video reality (most participants publish nothing) that worst case is mostly audio-mix traffic.
- coturn serves **both STUN and TURN on :3478** — even clients that never relay may use it for server-reflexive discovery once wired.
- Symmetric NAT cannot be punched by STUN at all — the architecture treats coturn as *mandatory in practice* (`meeting-media-architecture.md` §4.4), which is why it ships in the dev stack even though wiring is pending.

## 2. Deployment & configuration

```yaml
coturn:
  image: coturn/coturn:4.18.0-r0
  container_name: myrooms-coturn
  restart: always
  command:
    # coturn 4.18 removed --no-tls/--no-dtls/--log-device=stdout from its flag
    # set (TLS stays off unless certs are configured; stdout logging is the
    # default) — passing any of them makes turnserver print usage and exit 255.
    - -n
    - --lt-cred-mech
    - --fingerprint
    - --realm=myrooms.local
    - --static-auth-secret=devturnsecret
    - --min-port=61000
    - --max-port=61100
    - --external-ip=${TURN_EXTERNAL_IP:-127.0.0.1}
    - --no-cli
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "61000-61100:61000-61100/udp"
  healthcheck:
    # Alpine coturn image has no nc/curl — probe the listening socket via
    # /proc instead (3478 = hex 0D96 in the local_address column).
    test: ["CMD-SHELL", "grep -q ':0D96' /proc/net/udp || grep -q ':0D96' /proc/net/tcp || exit 1"]
```

All configuration is command-line flags (`-n` = no config file); no volume is mounted and there is no `docker/coturn/` config to keep in sync — compose is the single source.

| Flag | Meaning |
|---|---|
| `-n` | read no config file — flags only |
| `--lt-cred-mech` | long-term credentials (the TURN auth mechanism; required for any credentialed allocation) |
| `--fingerprint` | add the STUN `FINGERPRINT` attribute to messages (standard practice) |
| `--realm=myrooms.local` | the realm clients authenticate against (required with `--lt-cred-mech`) |
| `--static-auth-secret=devturnsecret` | enables the **REST-style time-limited credential** mechanism (§3) instead of static user accounts |
| `--min-port` / `--max-port` | the relay port range — **must match** the published `61000-61100/udp` mapping |
| `--external-ip` | the address advertised in relayed candidates — the host's reachable IP (Docker port-mapping / 1:1 NAT case); defaults to `127.0.0.1`, i.e. relay works on-host only |
| `--no-cli` | disable coturn's localhost telnet CLI (:5766) |

| Port | Protocol | Purpose |
|---|---|---|
| 3478 | udp **and** tcp | STUN + TURN listener (TCP fallback for UDP-blocked networks) |
| 61000–61100 | udp | relay allocations — must equal `--min-port`/`--max-port` |
| 5349 | — | TURN/TLS — **deliberately absent**: coturn 4.18 keeps TLS off unless certs are configured (the design doc's "optional TLS" was dropped) |

**`TURN_EXTERNAL_IP` is the one environment knob**: set it to the host's LAN IP for real-device/LAN dev — with the `127.0.0.1` default, relayed candidates point at loopback and unreachable from any other machine (`docs/implementation-status.md` §3).

## 3. Credential model — REST-style, time-limited

`--static-auth-secret` means coturn has **no user accounts**. Credentials are derived per the standard "REST API" scheme (the one Twilio/Xirsys popularized):

```text
username  = <unix-epoch expiry>          # optionally suffixed with a user id
credential = base64( HMAC-SHA1( username, static-auth-secret ) )
```

The client presents that pair in its ICE configuration; coturn recomputes the HMAC and rejects expired usernames. Consequences:

- **Some trusted component must mint the pair** — credentials cannot be static config in the browser. The natural owner is Spring (HMAC with `devturnsecret`, delivered alongside the other media credentials).
- **Clock skew matters** — the username is a timestamp; a client clock far ahead of the server authenticates against a future expiry, far behind gets premature expiry.
- The secret can be rotated by supplying it multiple times (old + new accepted during the overlap); here it is a single dev value, consistent with the repo's other dev secrets.

## 4. Current wiring status — deployed, not yet referenced

Honest state as of 2026-10-04: coturn runs and passes its healthcheck, but **neither media plane's client configuration points at it yet**.

| Plane | Status |
|---|---|
| LiveKit (video) | `docker/livekit/livekit.yaml` has `turn.enabled: false` (comment: *coturn owns 3478* — LiveKit's **embedded** TURN stays off so the port isn't fought over). LiveKit only distributes TURN credentials for its own embedded TURN, so with it off the browser receives no TURN server in signaling. The Angular client connects with `room.connect(url, token, { autoSubscribe: false })` and **no `rtcConfig`** (`frontend/src/app/service/meeting-media.service.ts`) ⇒ ICE uses host candidates plus a public STUN server — no coturn relay |
| Janus (audio) | the browser WS client is pending altogether (`docs/janus.md` §5) — when it lands, its `RTCPeerConnection` must be given `iceServers` explicitly |

The wiring plan implied by the architecture (`meeting-media-architecture.md` §4.4 + §6): Spring mints the REST-style pair (§3) and extends the media credentials with it; the video plane passes `rtcConfig: { iceServers: [{ urls: "turn:…:3478", username, credential }] }` into `room.connect`; the audio plane does the same at PeerConnection creation. Until then, connectivity beyond cone-NAT depends on STUN alone — symmetric-NAT clients (the case coturn exists for) will not connect. The pending two-browser validation pass (`docs/implementation-status.md` §1) is the natural moment to wire and verify it.

## 5. Operations & troubleshooting

```bash
docker compose ps coturn             # healthcheck: /proc/net socket probe (image has no nc/curl)
docker logs myrooms-coturn           # allocation + auth log
docker exec myrooms-coturn sh -c \
  'grep -i ":0D96" /proc/net/udp'    # is :3478 actually listening (0D96 = 3478 hex)
```

| Symptom | Cause / handling |
|---|---|
| Container restart-loops, logs show usage text + `exit 255` | the removed 4.18 flags (`--no-tls` / `--no-dtls` / `--log-device=stdout`) are being passed somewhere — they no longer exist (`docs/implementation-status.md` §3) |
| Relay works on the host but never from another device | `TURN_EXTERNAL_IP` unset — relayed candidates advertise `127.0.0.1`; set it to the LAN IP |
| Signaling fine, relayed candidates unreachable | relay range mismatch (`--min-port/--max-port` vs the compose UDP mapping) or macOS Docker UDP forwarding (flakiest part of local WebRTC dev — verify on a real LAN, `docs/implementation-status.md` §3) |
| TURN allocation 401s once wired | wrong HMAC input (username string, not bytes-to-hex), wrong secret, or clock skew between minter and coturn (§3) |
| UDP fully blocked on a client network | 3478/tcp is published — TURN-over-TCP works; the media servers' own TCP fallbacks are separate (`livekit.md` §2.1: 7881/tcp) |

One naming trap: coturn's realm is `myrooms.local` — cosmetic for auth (clients echo it), but it must stay consistent if a config file ever replaces the flags.
