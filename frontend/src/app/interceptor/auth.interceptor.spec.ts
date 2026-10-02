import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from 'service/auth.service';
import { ModalService } from 'service/modal.service';
import type { JwtClaims } from 'util/jwt-util';

const URL = `${environment.apiUrl}/currencies`;
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
  return { status: 401, message: 'Token expired' };
}

function unauthorizedResponse() {
  return { status: 401, statusText: 'Unauthorized' };
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let openLoginSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    openLoginSpy = vi.spyOn(TestBed.inject(ModalService), 'openLogin');
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Drive a real login through the mock backend so the service state is genuine. Returns the access token. */
  function login(claims: Partial<JwtClaims> = {}): string {
    const accessToken = makeToken(claims);
    auth.login({ email: 'user@test.com', password: 'pw' }).subscribe();
    httpMock.expectOne((req) => req.url === LOGIN_URL).flush({ accessToken });
    return accessToken;
  }

  it('adds no Authorization header without a session', () => {
    http.get(URL).subscribe();
    const req = httpMock.expectOne((r) => r.url === URL);

    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('attaches the Bearer header for a live session', () => {
    const accessToken = login({ sub: 'a@b.c' });
    http.get(URL).subscribe();
    const req = httpMock.expectOne((r) => r.url === URL);

    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('refreshes proactively when the access token is expired, then sends with the new token', () => {
    login({ exp: Math.floor(Date.now() / 1000) - 10 });
    http.get(URL).subscribe();

    const refresh = httpMock.expectOne((r) => r.url === REFRESH_URL);
    expect(refresh.request.body).toBeNull();
    // The refresh call itself bypasses the interceptor: no header, no recursion.
    expect(refresh.request.headers.has('Authorization')).toBe(false);
    const rotated = makeToken({ sub: 'user@test.com' });
    refresh.flush({ accessToken: rotated });

    const req = httpMock.expectOne((r) => r.url === URL);
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${rotated}`);
    req.flush([]);
  });

  it('clears the session and opens the login modal when a proactive refresh fails', () => {
    login({ exp: Math.floor(Date.now() / 1000) - 10 });
    http.get(URL).subscribe();

    httpMock.expectOne((r) => r.url === REFRESH_URL).flush(unauthorized(), unauthorizedResponse());
    // Continues anonymously so public requests still resolve.
    const req = httpMock.expectOne((r) => r.url === URL);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);

    expect(auth.token()).toBeNull();
    expect(auth.sessionActive()).toBe(false);
    expect(openLoginSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once with the rotated token after a reactive 401', () => {
    login();
    http.get(URL).subscribe();

    httpMock.expectOne((r) => r.url === URL).flush(unauthorized(), unauthorizedResponse());
    const refresh = httpMock.expectOne((r) => r.url === REFRESH_URL);
    const rotated = makeToken({ sub: 'user@test.com' });
    refresh.flush({ accessToken: rotated });

    const retry = httpMock.expectOne((r) => r.url === URL);
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${rotated}`);
    retry.flush([]);
    expect(httpMock.match(() => true)).toHaveLength(0); // nothing else was issued
  });

  it('propagates the error when the retried request fails again, without a second refresh', () => {
    login();
    const errors: unknown[] = [];
    http.get(URL).subscribe({ error: (error) => errors.push(error) });

    httpMock.expectOne((r) => r.url === URL).flush(unauthorized(), unauthorizedResponse());
    httpMock.expectOne((r) => r.url === REFRESH_URL).flush({ accessToken: makeToken() });
    httpMock.expectOne((r) => r.url === URL).flush(unauthorized(), unauthorizedResponse());

    expect(errors.length).toBe(1);
    expect(httpMock.match(() => true)).toHaveLength(0); // exactly one refresh happened
  });

  it('does not attempt a refresh when an /auth request fails (login failure path)', () => {
    login();
    const errors: unknown[] = [];
    auth.login({ email: 'user@test.com', password: 'wrong' }).subscribe({ error: (error) => errors.push(error) });

    httpMock.expectOne((r) => r.url === LOGIN_URL).flush(unauthorized(), unauthorizedResponse());

    expect(errors.length).toBe(1);
    expect(httpMock.match(() => true)).toHaveLength(0); // no refresh queued
  });

  it('shares one refresh across concurrent 401s (single-flight)', () => {
    login();
    http.get(URL).subscribe({ error: () => undefined });
    http.get(URL).subscribe({ error: () => undefined });

    const originals = httpMock.match((r) => r.url === URL);
    expect(originals).toHaveLength(2);
    originals.forEach((r) => r.flush(unauthorized(), unauthorizedResponse()));

    const refresh = httpMock.expectOne((r) => r.url === REFRESH_URL); // throws unless exactly one
    const rotated = makeToken({ sub: 'user@test.com' });
    refresh.flush({ accessToken: rotated });

    const retries = httpMock.match((r) => r.url === URL);
    expect(retries).toHaveLength(2);
    retries.forEach((r) => {
      expect(r.request.headers.get('Authorization')).toBe(`Bearer ${rotated}`);
      r.flush([]);
    });
  });

  it('lets /auth/refresh pass through untouched even with a live session', () => {
    login();
    auth.refreshSession().subscribe({ error: () => undefined });

    const req = httpMock.expectOne((r) => r.url === REFRESH_URL);
    expect(req.request.headers.has('Authorization')).toBe(false);
    // Still credentialed: the HttpOnly cookie is the refresh credential.
    expect(req.request.withCredentials).toBe(true);
    req.flush({ accessToken: makeToken() });
  });
});

describe('authInterceptor (credentials)', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('marks /auth requests credentialed so the HttpOnly cookie flows', () => {
    auth.login({ email: 'user@test.com', password: 'pw' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === LOGIN_URL);
    expect(req.request.withCredentials).toBe(true);
    req.flush({ accessToken: makeToken() });
  });

  it('marks logout requests credentialed (the cookie carries the token to revoke)', () => {
    auth.login({ email: 'user@test.com', password: 'pw' }).subscribe();
    httpMock.expectOne((r) => r.url === LOGIN_URL).flush({ accessToken: makeToken() });

    auth.logout();
    const req = httpMock.expectOne((r) => r.url === LOGOUT_URL);
    expect(req.request.withCredentials).toBe(true);
    req.flush({ message: 'Logout OK' });
  });

  it('leaves non-/auth requests uncredentialed (Bearer-only; the cookie is Path=/auth)', () => {
    http.get(URL).subscribe();
    const req = httpMock.expectOne((r) => r.url === URL);

    expect(req.request.withCredentials).toBe(false);
    req.flush([]);
  });
});
