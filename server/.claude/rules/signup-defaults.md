---
description: Signup behavior — default BASIC AccountLevel via get-or-create and generated ACC-uuid account number; no seed data
globs:
  - "src/main/java/**/services/auth/**"
  - "src/main/java/**/models/User.java"
  - "src/main/java/**/models/AccountLevel.java"
  - "src/main/java/**/repo/AccountLevelRepo.java"
alwaysApply: false
---

# Signup Defaults

Signup assigns a default `BASIC` `AccountLevel` via get-or-create in `AuthServiceImpl.defaultAccountLevel()` and a generated `ACC-<uuid>` account number — there is no seed mechanism, so the first signup creates the level row. It also hardcodes role `ROLE_ADMIN` and status `"true"` for every new user (known issue — see `project-overview.md`).