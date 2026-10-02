---
description: Lombok and MapStruct wiring — annotation processor ordering in pom.xml and response-building conventions
globs: ["pom.xml", "src/main/java/**/*.java"]
alwaysApply: false
---

# Code Generation

- Lombok + MapStruct are wired via `annotationProcessorPaths` in `pom.xml` (with `lombok-mapstruct-binding` — keep that ordering if you touch the POM). MapStruct is dead weight right now: zero `@Mapper` interfaces exist in this codebase.
- Constructor injection is the norm, with four field-injection holdouts: `WebSecurityConfiguration` (`JwtRequestFilter`, `RateLimitFilter`), `EmailUtil` (`JavaMailSender`), `UserDetailsServiceImpl` (`UserRepo`).
- Controllers/services build responses through `MeetingRoomUtils.getResponseEntity` and constants in `constants/` (note the `"messag"` key typo in its JSON body — known issue, `project-overview.md`).
