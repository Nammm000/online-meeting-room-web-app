---
description: PostgreSQL setup and schema management — ddl-auto=update behavior and manual schema fixes
globs:
  - "src/main/resources/application*.properties"
  - "docker-compose*.yml"
  - "src/main/java/**/models/**"
alwaysApply: false
---

# Database & Schema Management

- Postgres 16 runs via `docker compose up -d` (db: `myrooms`, user: `myuser`/`mypassword`, host port 5434 → container 5432; the app connects to `localhost:5434/myrooms`).
- `spring.jpa.hibernate.ddl-auto=update` — there are no migrations; Hibernate mutates the schema from entity mappings on startup.
- Adding columns works; changing constraints on existing columns does not. Deviating DB state is fixed manually.