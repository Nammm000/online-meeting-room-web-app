---
description: Build, run, and test commands — Docker Postgres, Maven, and the required JDK 17 setup
alwaysApply: true
---

# Commands

```bash
docker compose up -d        # start Postgres 16 (host port 5434), MinIO (9002/9003), and Redis (6378, cache)
mvn spring-boot:run         # run app on port 8083 (requires Postgres + MinIO running)
mvn clean package           # build (skip tests with -DskipTests)
mvn test                    # run all tests
mvn test -Dtest=SomeClassTest#methodName   # run a single test
```

## Runtime dependencies

Postgres and MinIO are hard boot dependencies — `MinioConfiguration` bootstraps buckets at startup and the app fails to boot if MinIO (`localhost:9002`) is unreachable. Redis is a soft dependency today: the app is configured at `spring.data.redis.port=6379` while compose publishes `6378` (known mismatch — `project-overview.md`), nothing is `@Cacheable`, and the lone `@CacheEvict` degrades gracefully to DB on failure.

## JDK requirement

Build with JDK 17 — the system Maven defaults to JDK 25, which Lombok 1.18.36 does not support (`TypeTag :: UNKNOWN` error):

```bash
export JAVA_HOME=/Users/namnlh/Library/Java/JavaVirtualMachines/ms-17.0.18/Contents/Home
```

- `./mvnw` is broken (missing `.mvn/wrapper/`); use system `mvn`.
- Tests live in `src/test/java` (note the misleading layout: directory `tech/getarrays/assetmanager/`, package `tech.getarrays.meetingroom`) — plain JUnit 5 + AssertJ, no Spring context; Mockito appears only in `NotificationWebSocketHandlerTest` (testability hooks are package-private constructors/members; `MockMultipartFile` for multipart input).