import { RenderMode, ServerRoute } from '@angular/ssr';

// Every page is auth-gated on a memory-only session that only the browser can
// hydrate (startup cookie-refresh via provideAppInitializer, a server no-op) —
// the server can never render them (the guard would open the login modal during
// SSR). Serve the shell and let routing run in the browser only.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
