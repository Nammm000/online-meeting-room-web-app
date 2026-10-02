---
description: Global exception handling — AllExceptionHandler status mapping, ErrorResponseDTO shape, and the services-throw/controllers-don't-catch convention
globs:
  - "src/main/java/**/exception/**"
  - "src/main/java/**/dto/ErrorResponseDTO.java"
alwaysApply: false
---

# Exception Handling

`exception/AllExceptionHandler` (@ControllerAdvice) is the single error renderer. The convention is services throw and controllers don't catch — with known exceptions below:

| Exception | Status |
|---|---|
| `UserNotFoundException` | 404 |
| `NotFoundException` | 404 |
| `AccessDeniedException` (Spring Security) | 403 |
| `InvalidTokenException` | 401 |
| `ExpiredJwtException` (jjwt) | 401 "Token expired" |
| `ConflictException` | 409 |
| `MaxUploadSizeExceededException` | 400 |
| `Exception` (catch-all) | 400 |

Error body is `dto/ErrorResponseDTO` with `status`, `message`, `timeStamp` (epoch millis) — note the actual field spellings, including the camelCase `timeStamp`.

`MaxUploadSizeExceededException` (a request exceeded `spring.servlet.multipart.max-file-size` / `max-request-size`) renders a dynamic message naming the tripped limit in MB (`exc.getMaxUploadSize()`, `-1` → generic wording with no number).

Convention caveats: `AuthenticationController` catches internally in login / forgot-password / change-password (known issue, `project-overview.md`), and two service methods catch rather than throw — `UserService.getAllUser` returns 500 on any exception, `UserService.updateUserRole` returns 400 on a bad enum value.

Input validation historically threw `IllegalArgumentException(AssetConstants.INVALID_DATA)` → 400 catch-all, but `AssetConstants.INVALID_DATA` is currently referenced nowhere (the asset services that threw it are gone). There is no dedicated handler for `MethodArgumentNotValidException`/bean-validation; DTO constraints, if added, would also fall through to the 400 catch-all.
