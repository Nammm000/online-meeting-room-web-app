import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, take, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from 'service/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const authBase = `${environment.apiUrl}/auth/`;

  // (-1) Every /auth/* request is credentialed so the HttpOnly refresh cookie flows
  //     both ways (set on login/signup/refresh, sent on refresh/logout, cleared on
  //     logout/change-password). Cloned BEFORE the refresh bypass below so the
  //     bypassed POST carries it too. Cloning adds no header, so it cannot recurse
  //     and the URL-equality checks stay intact. Non-/auth URLs stay cookie-less
  //     Bearer auth — Path=/auth means the browser wouldn't send the cookie there
  //     anyway.
  if (req.url.startsWith(authBase) && !req.withCredentials) {
    req = req.clone({ withCredentials: true });
  }

  // (0) /auth/refresh bypasses everything: proactively refreshing it would recurse
  //     (its own POST re-enters this interceptor), and rotation makes a second
  //     call replay a just-deleted token and 401 the session.
  if (req.url === `${authBase}refresh`) {
    return next(req);
  }
  // /auth/* URLs are excluded from the reactive 401 retry only (a failed login
  // must surface its error, not loop into a refresh); they still participate in
  // proactive refresh — logout and change-password are JWT-protected.
  const isAuthUrl = req.url.startsWith(authBase);
  const token = auth.token();
  const withBearer = (r: HttpRequest<unknown>, t: string) =>
    next(r.clone({ setHeaders: { Authorization: `Bearer ${t}` } }));

  if (token !== null && auth.hasLiveAccessToken()) {
    // (1) Live token → attach (public endpoints ignore a valid header). Reactive
    //     safety net: a 401 (clock skew, revoked-mid-flight token) triggers one
    //     refresh + retry for non-/auth URLs. The retry is structural, not
    //     flag-based: it flows through next() only — interceptors do not re-run
    //     for it — so a 401 on the retry propagates to the caller.
    return withBearer(req, token).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthUrl) {
          return auth.refreshSession().pipe(
            take(1),
            switchMap(() => withBearer(req, auth.token()!)),
            // Refresh failed → the session is dead; propagate the ORIGINAL 401.
            catchError(() => {
              auth.sessionExpired();
              return throwError(() => error);
            }),
          );
        }
        return throwError(() => error);
      }),
    );
  }

  if (auth.sessionActive()) {
    // (2) Access token expired/undecodable but the tab still holds a session →
    //     proactive single-flight refresh, then send with the new header. On
    //     failure: clear the session, prompt re-login, and continue anonymously
    //     so public requests still resolve. No 401 handler on this send: we
    //     refreshed moments earlier and another refresh-retry would only burn
    //     rotation.
    return auth.refreshSession().pipe(
      take(1),
      switchMap(() => withBearer(req, auth.token()!)),
      catchError(() => {
        auth.sessionExpired();
        return next(req);
      }),
    );
  }

  // (3) No session → anonymous. (The backend 401s bad Bearer headers cleanly, but
  //     only live tokens are ever attached, so expired ones never go out.)
  return next(req);
};
