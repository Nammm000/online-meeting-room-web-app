import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { authInterceptor } from 'interceptor/auth.interceptor';
import { AuthService } from 'service/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Blocks bootstrap until the startup cookie-refresh settles: the access token
    // is memory-only and the refresh cookie HttpOnly, so this is what restores the
    // session across reloads — and what lets the synchronous route guards decide
    // on settled state. A no-op on the server; a 401 resolves silently (guest).
    provideAppInitializer(() => inject(AuthService).restoreSession()),
    provideRouter(routes), provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor]))
  ]
};
