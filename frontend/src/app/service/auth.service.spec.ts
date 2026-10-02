import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ModalService } from 'service/modal.service';
import type { JwtClaims } from 'util/jwt-util';

const STORAGE_KEY = 'asset-manager.token';
const REFRESH_KEY = 'asset-manager.refreshToken';
const AVATAR_KEY = 'asset-manager.avatar';
const LOGIN_URL = `${environment.apiUrl}/auth/login`;
const LOGOUT_URL = `${environment.apiUrl}/auth/logout`;
const REFRESH_URL = `${environment.apiUrl}/auth/refresh`;

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(claims: Partial<JwtClaims> = {}): string {
  const full: JwtClaims = {
    sub: 'user@test.com',
    role: 'ROLE_USER',
    iat: 1000,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `header.${base64Url(JSON.stringify(full))}.signature`;
}

function unauthorized() {
  return { status: 401, message: 'Invalid refresh token' };
}

/** The refresh token travels as the HttpOnly cookie, never in these bodies. */
function authResponse(claims: Partial<JwtClaims> = {}): { accessToken: string } {
  return { accessToken: makeToken(claims) };
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
  });

  /** Log in through the mock backend so the session state is genuine. */
  function login(claims: Partial<JwtClaims> = {}): string {
    const accessToken = makeToken(claims);
    service.login({ email: 'a@b.c', password: 'pw' }).subscribe();
    httpMock.expectOne((req) => req.url === LOGIN_URL).flush({ accessToken });
    return accessToken;
  }

  it('installs the token, decodes claims, and keeps the session in memory on login', () => {
    const accessToken = login({ sub: 'a@b.c', role: 'ROLE_ADMIN' });

    expect(service.token()).toBe(accessToken);
    expect(service.email()).toBe('a@b.c');
    expect(service.role()).toBe('ROLE_ADMIN');
    expect(service.sessionActive()).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
    // Memory-only: nothing is ever written to localStorage.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('sends the login request credentialed so the cookie can be stored', () => {
    service.login({ email: 'a@b.c', password: 'pw' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === LOGIN_URL);
    expect(req.request.withCredentials).toBe(true);
    req.flush(authResponse());
  });

  it('leaves state untouched when login fails', () => {
    service.login({ email: 'a@b.c', password: 'wrong' }).subscribe({ error: () => undefined });
    httpMock
      .expectOne((req) => req.url === LOGIN_URL)
      .flush({ status: 400, message: 'Incorrect username or password!' }, { status: 400, statusText: 'Bad Request' });

    expect(service.token()).toBeNull();
    expect(service.sessionActive()).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
  });

  it('stays authenticated with an expired access token while a session is active', () => {
    const expiredToken = login({ exp: Math.floor(Date.now() / 1000) - 10 });

    expect(service.token()).toBe(expiredToken);
    expect(service.hasLiveAccessToken()).toBe(false);
    // Optimistic: the HttpOnly cookie may still revive the session.
    expect(service.isAuthenticated()).toBe(true);
  });

  it('installs the session on signup (backend auto-logs-in the new user)', () => {
    const accessToken = makeToken({ sub: 'new@b.c' });
    service.signup({ name: 'New', email: 'new@b.c', phone: '0123456789', password: 'Passw0rd!' }).subscribe();
    httpMock.expectOne((req) => req.url === `${environment.apiUrl}/auth/signup`).flush({ accessToken });

    expect(service.token()).toBe(accessToken);
    expect(service.email()).toBe('new@b.c');
    expect(service.sessionActive()).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('clears local session on logout even when the API call fails', () => {
    login({ sub: 'a@b.c' });

    service.logout();
    const req = httpMock.expectOne((r) => r.url === LOGOUT_URL);
    // No body: the HttpOnly cookie identifies the token to revoke server-side.
    expect(req.request.body).toBeNull();
    expect(req.request.withCredentials).toBe(true);
    req.flush(null, { status: 404, statusText: 'Not Found' });

    expect(service.token()).toBeNull();
    expect(service.sessionActive()).toBe(false);
    expect(service.email()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('refreshes first when the access token is expired so logout gets its Bearer header', () => {
    login({ sub: 'a@b.c', exp: Math.floor(Date.now() / 1000) - 10 });

    service.logout();
    const refresh = httpMock.expectOne((r) => r.url === REFRESH_URL);
    expect(refresh.request.body).toBeNull();
    expect(refresh.request.withCredentials).toBe(true);
    refresh.flush(authResponse({ sub: 'a@b.c' }));

    const req = httpMock.expectOne((r) => r.url === LOGOUT_URL);
    expect(req.request.body).toBeNull();
    req.flush({ message: 'Logout OK' });

    expect(service.token()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('still logs out locally when the pre-logout refresh fails', () => {
    const openLoginSpy = vi.spyOn(TestBed.inject(ModalService), 'openLogin');
    login({ sub: 'a@b.c', exp: Math.floor(Date.now() / 1000) - 10 });

    service.logout();
    httpMock.expectOne((r) => r.url === REFRESH_URL).flush(unauthorized(), {
      status: 401,
      statusText: 'Unauthorized',
    });
    const req = httpMock.expectOne((r) => r.url === LOGOUT_URL);
    expect(req.request.body).toBeNull();
    req.flush({ message: 'Logout OK' });

    expect(service.token()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    // A deliberate logout never flashes the login modal.
    expect(openLoginSpy).not.toHaveBeenCalled();
  });

  it('clears the session and opens the login modal on sessionExpired()', () => {
    const openLoginSpy = vi.spyOn(TestBed.inject(ModalService), 'openLogin');
    login({ sub: 'a@b.c' });

    service.sessionExpired();

    expect(service.token()).toBeNull();
    expect(service.sessionActive()).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
    expect(openLoginSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService (refreshSession)', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
  });

  function login(claims: Partial<JwtClaims> = {}): void {
    service.login({ email: 'a@b.c', password: 'pw' }).subscribe();
    httpMock.expectOne((req) => req.url === LOGIN_URL).flush(authResponse(claims));
  }

  it('errors immediately when no session is active (and never issues HTTP)', () => {
    const errors: unknown[] = [];
    service.refreshSession().subscribe({ error: (error) => errors.push(error) });

    expect(errors.length).toBe(1);
  });

  it('shares a single credentialed cookie-refresh between concurrent callers (rotation-safe)', () => {
    login({ sub: 'a@b.c' });

    const results: string[] = [];
    service.refreshSession().subscribe((response) => results.push(response.accessToken));
    service.refreshSession().subscribe((response) => results.push(response.accessToken));

    const refresh = httpMock.expectOne((r) => r.url === REFRESH_URL);
    expect(refresh.request.body).toBeNull();
    expect(refresh.request.withCredentials).toBe(true);
    const rotated = authResponse({ sub: 'a@b.c' });
    refresh.flush(rotated);

    expect(results).toEqual([rotated.accessToken, rotated.accessToken]);
    expect(service.token()).toBe(rotated.accessToken);
    expect(service.sessionActive()).toBe(true);
  });

  it('propagates a failed refresh to all callers and clears the in-flight request', () => {
    login({ sub: 'a@b.c' });

    const errors: unknown[] = [];
    service.refreshSession().subscribe({ error: (error) => errors.push(error) });
    httpMock.expectOne((r) => r.url === REFRESH_URL).flush(unauthorized(), {
      status: 401,
      statusText: 'Unauthorized',
    });
    expect(errors.length).toBe(1);

    // The in-flight slot was freed: a new call issues a fresh request.
    service.refreshSession().subscribe({ error: () => undefined });
    httpMock
      .expectOne((r) => r.url === REFRESH_URL)
      .flush(unauthorized(), { status: 401, statusText: 'Unauthorized' });
  });
});

describe('AuthService (session restore)', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  function setup(providers: Parameters<typeof TestBed.configureTestingModule>[0]['providers'] = []) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ...providers],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(AVATAR_KEY);
  });

  it('restores the session from the refresh cookie via one credentialed refresh', async () => {
    setup();
    expect(service.token()).toBeNull();

    const restored = authResponse({ sub: 'stored@b.c' });
    const promise = service.restoreSession();
    const req = httpMock.expectOne((r) => r.url === REFRESH_URL);
    expect(req.request.body).toBeNull();
    expect(req.request.withCredentials).toBe(true);
    req.flush(restored);
    await promise;

    expect(service.token()).toBe(restored.accessToken);
    expect(service.email()).toBe('stored@b.c');
    expect(service.sessionActive()).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('resolves silently as a guest when the cookie is absent or dead (no login modal)', async () => {
    setup();
    const openLoginSpy = vi.spyOn(TestBed.inject(ModalService), 'openLogin');

    const promise = service.restoreSession();
    httpMock.expectOne((r) => r.url === REFRESH_URL).flush(unauthorized(), {
      status: 401,
      statusText: 'Unauthorized',
    });
    await promise;

    expect(service.token()).toBeNull();
    expect(service.sessionActive()).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
    expect(openLoginSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when a session already exists (no second refresh)', async () => {
    setup();
    service.applyAuthenticationResponse(authResponse({ sub: 'a@b.c' }));

    await service.restoreSession();

    expect(service.isAuthenticated()).toBe(true);
  });

  it('never issues HTTP on the server (SSR/prerender)', async () => {
    setup([{ provide: PLATFORM_ID, useValue: 'server' }]);

    await service.restoreSession();

    expect(service.token()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('purges legacy localStorage token keys on construction but keeps the avatar', () => {
    localStorage.setItem(STORAGE_KEY, makeToken({ sub: 'legacy@b.c' }));
    localStorage.setItem(REFRESH_KEY, 'legacy-refresh');
    localStorage.setItem(AVATAR_KEY, 'https://example.com/me.png');
    setup();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(localStorage.getItem(AVATAR_KEY)).toBe('https://example.com/me.png');
    // The legacy token is NOT trusted as a session.
    expect(service.token()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('restores the avatar URL from localStorage on construction', () => {
    localStorage.setItem(AVATAR_KEY, 'https://example.com/me.png');
    setup();

    expect(service.avatarUrl()).toBe('https://example.com/me.png');
  });
});

describe('AuthService (avatar)', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(AVATAR_KEY);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(AVATAR_KEY);
  });

  it('persists the avatar URL through setAvatarUrl and clears it with null', () => {
    service.setAvatarUrl('https://example.com/other.png');
    expect(service.avatarUrl()).toBe('https://example.com/other.png');
    expect(localStorage.getItem(AVATAR_KEY)).toBe('https://example.com/other.png');

    service.setAvatarUrl(null);
    expect(service.avatarUrl()).toBeNull();
    expect(localStorage.getItem(AVATAR_KEY)).toBeNull();
  });

  it('never persists blob: object URLs — they die with the document', () => {
    localStorage.setItem(AVATAR_KEY, 'https://example.com/seed.png');

    service.setAvatarUrl('blob:http://localhost:4200/1234-abc');

    expect(service.avatarUrl()).toBe('blob:http://localhost:4200/1234-abc');
    // Memory-only in storage, and setting it retires the legacy seed.
    expect(localStorage.getItem(AVATAR_KEY)).toBeNull();
  });

  it('keeps the avatar URL on logout', () => {
    service.login({ email: 'a@b.c', password: 'pw' }).subscribe();
    httpMock.expectOne((req) => req.url === LOGIN_URL).flush(authResponse({ sub: 'a@b.c' }));

    service.setAvatarUrl('https://example.com/me.png');
    service.logout();
    httpMock
      .expectOne((req) => req.url === LOGOUT_URL)
      .flush({ message: 'Bye' });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(service.avatarUrl()).toBe('https://example.com/me.png');
    expect(localStorage.getItem(AVATAR_KEY)).toBe('https://example.com/me.png');
  });
});
