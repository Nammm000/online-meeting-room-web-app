# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Spring Boot 3.2.3 / Java 17 backend (package `tech.getarrays.meetingroom`) with JWT access + refresh tokens and the **meeting-room domain fully implemented at the backend**: entities/repos + the complete meeting control plane (services, controllers, media integration with self-hosted LiveKit/Janus/coturn — see `docs/meeting-media-architecture.md`). The Angular meeting UI does not exist yet; remaining work is tracked in `docs/implementation-status.md`. Forked from the sibling `assetManager` project — see `project-overview.md` for leftovers and known code issues.

Detailed guidance is split into topic-specific rule files in `.claude/rules/`:

- `project-overview.md` — project identity, assetManager fork provenance, legacy remnants, known code issues
- `commands.md` — Docker/Maven commands, runtime dependencies, and the JDK 17 requirement
- `architecture.md` — layered structure and cross-cutting components
- `api-surface.md` — endpoint map per controller and REST conventions
- `security-auth.md` — stateless JWT auth, filter chain, rate limiting, roles
- `domain-model.md` — User/AccountLevel/RefreshToken, image + PDF file models, role enum
- `exception-handling.md` — AllExceptionHandler status mapping and ErrorResponseDTO
- `database-schema.md` — Postgres setup and `ddl-auto=update` behavior
- `code-generation.md` — Lombok/MapStruct wiring and conventions
- `signup-defaults.md` — signup defaults (BASIC AccountLevel, `ACC-<uuid>`, ROLE_ADMIN)
- `email-credentials.md` — Gmail SMTP credentials location

Also in `docs/`: `meeting-database-design.md` (meeting domain schema — ERD, table specs, state machines, consistency rules), `meeting-media-architecture.md` (media-plane design + technology recommendation — SFU video via LiveKit, MCU audio via Janus AudioBridge, coturn; control-plane flows mapped to the DB; mediasoup alternative; design only, nothing implemented), and `websocket.md` (notification push). `redis.md`/`redisson-bloom-filter.md` describe the sibling assetManager project, not this one.
