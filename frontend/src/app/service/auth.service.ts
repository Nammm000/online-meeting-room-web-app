import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, of, share, take, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthenticationResponse,
  ChangePasswordRequest,
  EmailRequest,
  LoginRequest,
  LogoutResponse,
  SignupRequest,
} from 'model/auth.model';
import { MessageResponse } from 'model/common.model';
import type { Role } from 'model/user.model';
import { JwtClaims, decodeJwt, isExpired } from 'util/jwt-util';
import { ModalService } from 'service/modal.service';

/**
 * Every /auth call is credentialed: the HttpOnly refresh cookie must flow both
 * ways (stored on login/signup/refresh, sent on refresh/logout, cleared on
 * logout/change-password). Cross-origin cookies are only attached to requests
 * made with credentials: 'include'.
 */
const AUTH_REQUEST_OPTIONS = { withCredentials: true } as const;

/**
 * Single auth facade: JWT session state (signals) + /auth endpoint calls. The access
 * token lives ONLY in memory — reloading the page empties it; restoreSession() rebuilds
 * the session from the HttpOnly refresh cookie (which JS can neither read nor even
 * detect, hence the blind startup refresh).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly modalService = inject(ModalService);

  // Legacy localStorage keys from the pre-cookie design; purged once in the constructor.
  private readonly legacyTokenKey = 'asset-manager.token';
  private readonly legacyRefreshKey = 'asset-manager.refreshToken';

  // Memory-only access token; always null on startup (SSR and browser alike).
  private readonly _token = signal<string | null>(null);
  readonly token = this._token.asReadonly();

  private readonly _claims = signal<JwtClaims | null>(null);
  readonly claims = this._claims.asReadonly();

  readonly email = computed(() => this._claims()?.sub ?? null);
  readonly role = computed<Role | null>(() => this._claims()?.role ?? null);

  // The HttpOnly refresh cookie is invisible to JS, so this in-memory flag replaces
  // its old presence check as "this tab believes a session can be revived" — set on
  // login/signup/refresh, cleared on logout/session expiry. Only the server can
  // prove the cookie still valid (rotate does that).
  private readonly _sessionActive = signal(false);
  readonly sessionActive = this._sessionActive.asReadonly();

  /** In-flight /auth/refresh call shared by concurrent callers; null when idle. */
  private refreshInFlight: Observable<AuthenticationResponse> | null = null;

  // Avatar image URL; browser-only (null on the server). Hydrated by
  // UserImageService from GET /images/avatar on every session start (a blob:
  // object URL — the endpoint needs the JWT header, so it can't be an <img src>).
  // Deliberately NOT cleared on logout: re-hydration on the next session start
  // replaces it, and the initials fallback always derives from the current
  // JWT's sub claim.
  private readonly avatarStorageKey = 'asset-manager.avatar';
  private readonly _avatarUrl = signal<string | null>(this.readStoredAvatar());
  readonly avatarUrl = this._avatarUrl.asReadonly();

  constructor() {
    this.purgeLegacyStorage();
  }

  // Optimistic: authenticated while the access token is live OR the tab still
  // believes a session exists. The claims signals stay populated from the
  // possibly-expired access token, so email/role keep rendering during that window.
  // Still a method, not a computed: Date.now() is not reactive.
  isAuthenticated(): boolean {
    return this.hasLiveAccessToken() || this._sessionActive();
  }

  /** The access token exists, decodes and has not expired. */
  hasLiveAccessToken(): boolean {
    const claims = this._claims();
    return this._token() !== null && claims !== null && !isExpired(claims);
  }

  isAdmin(): boolean {
    return this.role() === 'ROLE_ADMIN';
  }

  login(request: LoginRequest): Observable<AuthenticationResponse> {
    return this.http
      .post<AuthenticationResponse>(`${environment.apiUrl}/auth/login`, request, AUTH_REQUEST_OPTIONS)
      .pipe(tap((response) => this.applyAuthenticationResponse(response)));
  }

  /** Signup auto-logs-in: the backend returns a fresh access token for the new user. */
  signup(request: SignupRequest): Observable<AuthenticationResponse> {
    return this.http
      .post<AuthenticationResponse>(`${environment.apiUrl}/auth/signup`, request, AUTH_REQUEST_OPTIONS)
      .pipe(tap((response) => this.applyAuthenticationResponse(response)));
  }

  /**
   * Exchange the refresh cookie for a rotated pair (new access token + new cookie).
   * Single-flight: concurrent callers share one request — rotation deletes the old
   * token server-side, so a second concurrent call would replay a deleted token and
   * 401 the whole session.
   */
  refreshSession(): Observable<AuthenticationResponse> {
    if (!this._sessionActive()) {
      return throwError(() => new Error('No active session'));
    }
    return this.requestRefresh();
  }

  /**
   * Startup hydration (provideAppInitializer): the access token is memory-only and
   * the refresh cookie invisible, so the only way to learn whether a session exists
   * is to try one refresh. 401 here is a normal guest visit — resolved silently,
   * never via sessionExpired()/the login modal. A no-op on the server (SSR never
   * fires HTTP or touches cookies).
   */
  restoreSession(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve();
    }
    if (this.hasLiveAccessToken() || this._sessionActive()) {
      return Promise.resolve();
    }
    return firstValueFrom(
      this.requestRefresh().pipe(
        map(() => void 0),
        catchError(() => of(void 0)),
      ),
    );
  }

  /** Session is dead (refresh failed mid-session): wipe local state and prompt re-login. */
  sessionExpired(): void {
    this.clearSession();
    this.modalService.openLogin();
  }

  logout(): void {
    const email = this.email();
    if (email === null) {
      this.clearSession();
      return;
    }
    const fireLogout = (): void => {
      // No body: the HttpOnly cookie identifies the token to revoke server-side.
      // Fire the request while the session is still live so the interceptor attaches
      // the Bearer header (interceptors run synchronously at subscribe time), then
      // clear local state. Local clearing is the real logout and must happen even
      // if this call fails.
      this.http
        .post<LogoutResponse>(`${environment.apiUrl}/auth/logout`, null, AUTH_REQUEST_OPTIONS)
        .pipe(take(1))
        .subscribe({ error: () => undefined });
      this.clearSession();
    };
    // /auth/logout is JWT-protected: when the access token has expired but the tab
    // still holds a session, refresh first so the logout call gets its header.
    // On refresh failure just log out locally — never flash the login modal on a
    // deliberate logout.
    if (!this.hasLiveAccessToken() && this._sessionActive()) {
      this.refreshSession()
        .pipe(take(1))
        .subscribe({ next: fireLogout, error: fireLogout });
    } else {
      fireLogout();
    }
  }

  forgotPassword(body: EmailRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${environment.apiUrl}/auth/forgot-password`, body, AUTH_REQUEST_OPTIONS);
  }

  changePassword(body: ChangePasswordRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${environment.apiUrl}/auth/change-password`, body, AUTH_REQUEST_OPTIONS);
  }

  hello(): Observable<string> {
    return this.http.get(`${environment.apiUrl}/auth/hello`, { ...AUTH_REQUEST_OPTIONS, responseType: 'text' });
  }

  /**
   * Install a login/signup/refresh response as the in-memory session. Public on
   * purpose: component specs use it to seed sessions now that tokens are never
   * persisted.
   */
  applyAuthenticationResponse(response: AuthenticationResponse): void {
    this._token.set(response.accessToken);
    this._claims.set(decodeJwt(response.accessToken));
    this._sessionActive.set(true);
  }

  /**
   * Shared single-flight refresh core (also used by restoreSession, which must run
   * without the sessionActive precondition — its whole job is discovering one).
   * Empty body: the refresh cookie is both credential and token to rotate.
   */
  private requestRefresh(): Observable<AuthenticationResponse> {
    if (this.refreshInFlight === null) {
      this.refreshInFlight = this.http
        .post<AuthenticationResponse>(`${environment.apiUrl}/auth/refresh`, null, AUTH_REQUEST_OPTIONS)
        .pipe(
          tap((response) => this.applyAuthenticationResponse(response)),
          // Before share(): after share() it would fire per-subscriber teardown and
          // null the field while the shared call is still serving other subscribers.
          finalize(() => {
            this.refreshInFlight = null;
          }),
          share(),
        );
    }
    return this.refreshInFlight;
  }

  private clearSession(): void {
    this._token.set(null);
    this._claims.set(null);
    this._sessionActive.set(false);
  }

  /** Remove pre-cookie-design localStorage tokens; they are dead weight now. */
  private purgeLegacyStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    localStorage.removeItem(this.legacyTokenKey);
    localStorage.removeItem(this.legacyRefreshKey);
  }

  /**
   * Set (or clear with null) the avatar URL. Only http(s) URLs persist —
   * blob: object URLs die with the document, so storing one would restore a
   * dead URL on reload (setting one also removes any stored legacy seed).
   */
  setAvatarUrl(url: string | null): void {
    this._avatarUrl.set(url);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (url === null || url.startsWith('blob:')) {
      localStorage.removeItem(this.avatarStorageKey);
    } else {
      localStorage.setItem(this.avatarStorageKey, url);
    }
  }

  private readStoredAvatar(): string | null {
    return isPlatformBrowser(this.platformId) ? localStorage.getItem(this.avatarStorageKey) : null;
  }
}
