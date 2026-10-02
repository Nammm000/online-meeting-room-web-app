# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Angular 21 frontend (standalone components, signals, SSR via Express) for online meeting room web app, paired with the Spring Boot backend in `../backend`. Auth (JWT access + refresh-token rotation: login/signup/logout/change-password via modals) is live — the 15-min access token is **memory-only** (restored at startup by a silent cookie-refresh in the app initializer) and the refresh token lives in an **HttpOnly cookie** (`SameSite=Strict`, `Path=/auth`) that JS can never read; dark/light theming is app-wide (Light⇄Dark header toggle, OS-preference default, no-flash inline script, semantic tokens in `src/scss/theme.scss`); UI pages exist only as unrouted stub components — their service/model layer is complete.

Detailed guidance is split into topic-specific rule files in `.claude/rules/`:

- `project-overview.md` — project identity, backend pairing, git status
- `commands.md` — dev/build/test commands, single-test invocation, tooling gaps
- `architecture.md` — signals state, auth session/interceptor/guard chain, modal pattern, HTTP service layer, forms
- `backend-api.md` — REST/JWT contract with the backend, endpoint map per service, `PagedResponseDTO`, error body shapes
- `conventions.md` — bare-specifier imports, naming, service/model patterns, SCSS split and budgets, locales, strict TS
