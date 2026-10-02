---
description: Project identity — Angular 21 standalone/signals/SSR frontend for the asset-management app, paired with the Spring Boot backend in ../backend
alwaysApply: true
---

# Project Overview

- Angular 21 frontend (standalone components, signals, SSR via Express) for a personal asset management app. Auth is live (JWT login/signup/logout/change-password via modals); asset UI pages are scaffolded stubs only (dashboard, savings-passbooks, land-assets, cash-assets, other-assets, currencies, sidebar — none routed or mounted); services and models for them are complete and tested.
- The Spring Boot 3.2.3 / Java 17 backend lives in `../backend` (runs on port 8083, CORS allows this app's dev origin). Its detailed docs are in `../backend/CLAUDE.md` and `../backend/.claude/rules/` — notably `api-surface.md` (REST contract), `security-auth.md` (JWT), `asset-business-rules.md`, and `database-schema.md`.
- Neither directory is a git repository.
