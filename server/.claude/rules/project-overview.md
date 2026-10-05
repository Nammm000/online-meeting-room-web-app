---
description: Project identity — temporary registration/login backend forked from the assetManager project, plus legacy remnants and known code issues
alwaysApply: true
---

# Project Overview

- Spring Boot 3.2.3 / Java 17 backend (package `tech.getarrays.meetingroom`), currently a **temporary project for registration and login** with JWT access + refresh tokens.
- Forked from the sibling project at `~/Desktop/workspace/code/assetManager/backend` (package `tech.getarrays.assetmanager`) with the entire asset/currency domain removed. The Maven artifact is `AssetManager` (not `CinemaManager`); legacy strings survive in `EmailUtil` ("Cafe Management System") and `AssetConstants.STORE_LOCATION` (a Windows path).
- Not a git repository.
- Frontend is a separate Angular app (dev URL `http://localhost:4200`, wired via `app.client.url` into CORS in `WebSecurityConfiguration.corsConfigurationSource` and the WebSocket allowed-origins).

## Legacy remnants (dead, left over from the fork)

None of these have consumers — don't build on them, and don't chase them when reading code:

- `constants/AssetConstants` — cache-name constants (superseded by `CacheConstants`) + `STORE_LOCATION`; `INVALID_DATA` is referenced nowhere
- `dto/BulkDeleteRequestDTO` — orphaned (its bulk-delete endpoints left with the asset domain)
- `PagedResponseDTO.empty()` — helper for the removed bloom-filter path
- Guava dependency in `pom.xml`
- `UserRepo.findFirstByAccountNumber` — leftover hook for the removed deposit flow
- Test sources sit in `src/test/java/tech/getarrays/assetmanager/` but declare `package tech.getarrays.meetingroom` — compiles fine, but the layout is misleading

## Known code issues (docs-only review, 2026-10-02)

Found while verifying the docs; deliberately not fixed yet:

1. **Every signup gets `ROLE_ADMIN`** — `AuthServiceImpl` sets the role directly at signup.
2. **Disabled users can still log in** — `UserDetailsServiceImpl` never maps `User.status` to Spring's `enabled` flag, so the login 404 "User is not activated" branch is unreachable.
3. **Forgot-password emails the bcrypt password hash** (not a usable password); the 200 response strings differ slightly between existing/missing users; SMTP failure → 500.
4. `MeetingRoomUtils.getResponseEntity` emits the misspelled JSON key `"messag"`.
5. **8 dead `permitAll` routes** in `WebSecurityConfiguration` (`/dashboard/details`, `/news/*` ×4, `/plan/*` ×3) with no controllers behind them.
6. `constants/PaymentConstants.java` contains unused hardcoded payment-gateway sandbox credentials (dead code, but real-looking secrets in source).
7. `AuthenticationController` breaks the thin-controller convention — login, forgot-password, and change-password hold try/catch + business logic.

(Resolved 2026-10-05: the former Redis port mismatch — properties at `6379` vs compose `6378` — was fixed to `6378` when the PDF read caches went live; see `docs/redis.md`.)
