---
description: Build, run, and test commands — dev server, production/SSR builds, Vitest single-test invocation
alwaysApply: true
---

# Commands

```bash
npm start                        # dev server at http://localhost:4200
npm run build                    # production build → dist/frontend/{browser,server}
npm run watch                    # development build with watch
npm test                         # unit tests (Vitest via ng test, jsdom)
npx ng test --include='src/app/component/modal-form/login/login.spec.ts'  # single spec file
npx ng test --filter='^Login'    # filter by test-suite name
npm run serve:ssr:frontend       # run built SSR server (node dist/frontend/server/server.mjs, port 4000)
npx ng generate component <name> # scaffolds SCSS-component; selector prefix is app-
```

- Specs cover components (`src/app/component/**`), the `auto-hide-scrollbar` directive, `route-guard.service`, `auth.interceptor`, `auth.service`, `theme.service`, and `jwt-util` — 25 spec files total.
- No linter configured. Prettier is a devDependency but has no config file or script.
- Tests use Vitest globals (`describe`/`it`/`expect` need no imports — see `tsconfig.spec.json`).
