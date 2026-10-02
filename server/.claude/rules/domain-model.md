---
description: JPA domain model — User/AccountLevel/RefreshToken, the avatar Image hierarchy, UserPdfFile, and role enum conventions
globs:
  - "src/main/java/**/models/**"
  - "src/main/java/**/repo/**"
  - "src/main/java/**/dto/**"
  - "src/main/java/**/wrapper/**"
alwaysApply: false
---

# Domain Model

There is no asset domain — no `Asset`, `Currency`, or `spec/` classes (removed in the fork; see `project-overview.md`). The entities are:

- **`User`** (`users` table): unique `email`, `phone`, `name`, `passwordHash`, `@Enumerated(STRING) role`, unique `accountNumber`, `createdAt` (set in `@PrePersist`), `status` (plain String — `"true"`/`"false"`, never consulted at login), and a required `@ManyToOne accountLevel`. Carries the `getAllUser`/`updateStatus` `@NamedQuery`s behind `UserRepo`. **No cascaded collections** — nothing hangs off `User` in JPA terms.
- **`AccountLevel`** (`account_levels`): unique `code`, `name`, `description`. The `BASIC` row is get-or-create at first signup (see `signup-defaults.md`).
- **`RefreshToken`** (`refresh_tokens`): unique 64-char `token`, `expiresAt` (7 days), `createdAt`, required `@ManyToOne user`. No collection on `User` — deletes go through bulk JPQL in `RefreshTokenRepo`.
- **`models/image/Image`** (abstract, `images` table, JOINED inheritance): `@OneToOne user` on a **unique `user_id`** (→ at most one image row per user), `objectKey`, `contentType`, `fileSize`; `ImageType` enum (`AVATAR` only). Its sole subclass **`UserImage`** (`user_image` table) forces `imageType = AVATAR` in `@PrePersist`.
- **`models/file/UserPdfFile`** (`user_pdf_files`): standalone entity on purpose — the avatar hierarchy's unique `user_id` can't model many files per user, so this uses a plain `@ManyToOne user` plus a UUID-based `objectKey`, the sanitized display `fileName`, `contentType`, `fileSize`, `createdAt`.
- **`models/meeting/Meeting`** (`meetings`): the meeting-room domain (schema + repos only — **no services/controllers yet**; full design in `docs/meeting-database-design.md`). Scheduled/instant meeting with a unique 10-char base32 `joinCode` (the only external identifier), nested enums `MeetingType {SCHEDULED, INSTANT}` / `MeetingStatus {SCHEDULED, IN_PROGRESS, ENDED, CANCELLED}`, nullable schedule/actual timestamps, and the settings booleans `waitingRoomEnabled`/`muteOnEntry`/`locked`. `@ManyToOne host` deliberately duplicates the HOST participant row (host-ownership checks + "my meetings" stay single-table). First tables in the codebase to declare `@Table(uniqueConstraints=…, indexes=…)` — Postgres doesn't index FK columns on its own.
- **`models/meeting/MeetingParticipant`** (`meeting_participants`): one row per (meeting, user) — **unique (meeting_id, user_id)**; rejoin reuses the row (`joinCount++`), no sessions table. Nested enums `ParticipantRole {HOST, COHOST, PARTICIPANT}` / `ParticipantStatus {WAITING, JOINED, LEFT, REMOVED, DENIED, DECLINED}` — WAITING *is* the waiting room. Nullable `admittedBy` records who let someone in. Exactly one HOST row per meeting is service-enforced (not expressible in JPA).
- **`models/meeting/MeetingChatMessage`** (`meeting_chat_messages`): per-meeting text chat persisted past the end; soft-deleted via `deletedAt`/`deletedBy` (visible iff null). `ChatMessageType {TEXT}` is a single value today so attachments later are an enum addition, not a migration. Meeting-deletion order (service contract): chat → participants → meeting row, via the bulk JPQL methods in `MeetingChatMessageRepo`/`MeetingParticipantRepo`/`MeetingRepo`.

Roles: `User.Role` enum — `ROLE_USER`, `ROLE_ADMIN`, `ROLE_CUSTOMER` (values include the `ROLE_` prefix). `UserDetailsServiceImpl` maps the enum name straight to a granted authority, which is what makes `hasRole('ADMIN')` work.
