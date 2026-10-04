# Error Record: "Cannot resolve symbol 'WebhookReceiver'" in `LiveKitWebhookController`

**Date:** 2026-10-04
**Affected files:** `controllers/LiveKitWebhookController.java` (line 3 import + usage), `configuration/MediaConfiguration.java` (bean declaration)
**Outcome:** No code or POM change was needed — the error was IDE-side only. Resolved by reimporting the Maven project in IntelliJ.

## Symptom

IntelliJ flagged `io.livekit.server.WebhookReceiver` as unresolvable (red import):

```java
import io.livekit.server.WebhookReceiver;   // Cannot resolve symbol 'WebhookReceiver'
```

Both usages were affected:

- `LiveKitWebhookController` — constructor injection + `webhookReceiver.receive(body, authorization)` in the `POST /webhooks/livekit` handler
- `MediaConfiguration.liveKitWebhookReceiver()` — `new WebhookReceiver(apiKey, apiSecret)` bean

## Root cause

**A stale IntelliJ project model / index — not a code or dependency problem.** The
LiveKit SDK dependency was never added to the IDE's cached classpath:

- `server/.idea/` was missing `modules.xml` and any `.iml` file entirely, so
  IntelliJ was running off stale caches rather than a current Maven import.
- `.idea/compiler.xml` still referenced the legacy module names
  `CinemaManager` / `AssetManager` from the fork lineage.
- The `io.livekit:livekit-server:0.16.0` dependency (jar downloaded to the local
  Maven repo on 2026-09-15) postdated the IDE's cached project model, so the
  jar never made it onto the module classpath — javac resolved it fine, the IDE
  did not.

## Investigation performed (all checks passed — proving the code was correct)

| Check | Command | Result |
|---|---|---|
| Maven build | `mvn compile` with JDK 17 (`export JAVA_HOME=…/ms-17.0.18/…`) | Succeeds, zero errors |
| Dependency in local repo | `ls ~/.m2/repository/io/livekit/livekit-server/0.16.0/` | Jar present, **SHA-1 matches** the recorded checksum, zip structure valid |
| Class inside the jar | `unzip -l livekit-server-0.16.0.jar \| grep WebhookReceiver` | `io/livekit/server/WebhookReceiver.class` present |
| Class loads + API shape | `javap -classpath … io.livekit.server.WebhookReceiver` | `public WebhookReceiver(String, String)` and `receive(String, String)` match exactly how the code calls it |
| POM declaration | `pom.xml` | `io.livekit:livekit-server:0.16.0`, compile scope |

Since the command-line build was green while only the IDE showed the error, the
fault line was drawn between the toolchain (correct) and the IDE project model
(stale).

## Troubleshooting steps (in order — stop when the red disappears)

1. **Reload the Maven project** — Maven tool window → *Reload All Maven Projects*
   (⇧⌘I), or right-click `pom.xml` → *Maven → Reload Project*. This re-resolves
   dependencies onto the IDE classpath and regenerates the missing module files.
   Fixes the vast majority of "Cannot resolve symbol" cases after a dependency
   was added.
2. **Invalidate caches** — *File → Invalidate Caches… → Invalidate and Restart*.
   Clears the stale index that kept serving the old classpath.
3. **Last resort: clean reimport** — close IntelliJ, delete the stale
   `server/.idea/` folder (every file in it — `compiler.xml`, `vcs.xml`,
   `misc.xml`, … — is auto-regenerated on import), then reopen `pom.xml` as a
   project. Only needed when the module model itself is broken (e.g. missing
   `modules.xml`).

## Verification

- The import at `LiveKitWebhookController.java:3` and the bean in
  `MediaConfiguration` show no red; ⌘B / Ctrl+B navigation jumps into the SDK.
- `mvn compile` (JDK 17) stays green — unchanged, since no source was touched.
- Runtime smoke test (optional): start the app and POST an unsigned JSON body to
  `POST /webhooks/livekit` — expect **401 "Invalid LiveKit webhook signature"**,
  which proves the `WebhookReceiver` bean was wired correctly and signature
  verification is active.

## Lesson

A "Cannot resolve symbol" in the IDE with a green `mvn compile` is almost always
IDE state, not the codebase. Always run the CLI build first to decide which side
to fix — changing source files to silence an IDE-only error would have corrupted
working code.
