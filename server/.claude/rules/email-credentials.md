---
description: Gmail SMTP credentials for forgot-password email sit directly in application.properties
globs: ["src/main/resources/application*.properties"]
alwaysApply: false
---

# Email Credentials

Email (Gmail SMTP for forgot-password) credentials sit directly in `application.properties` (`spring.mail.*`); the from-address is hardcoded in `util/EmailUtil`. Separately, `constants/PaymentConstants.java` holds unused payment-gateway sandbox credentials (dead code — see `project-overview.md`).