import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot } from '@angular/router';
import { environment } from '../../environments/environment';
import { RouteGuardService, authGuard } from './route-guard.service';
import { AuthService } from 'service/auth.service';
import { ModalService } from 'service/modal.service';
import type { JwtClaims } from 'util/jwt-util';

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

/** The guard only reads `data` from the snapshot; a minimal stand-in is enough. */
function snapshotWithData(data: Record<string, unknown>): ActivatedRouteSnapshot {
  return { data } as unknown as ActivatedRouteSnapshot;
}

describe('RouteGuardService', () => {
  let guard: RouteGuardService;
  let auth: AuthService;
  let modal: ModalService;
  let httpMock: HttpTestingController;
  let openLoginSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    guard = TestBed.inject(RouteGuardService);
    auth = TestBed.inject(AuthService);
    modal = TestBed.inject(ModalService);
    httpMock = TestBed.inject(HttpTestingController);
    openLoginSpy = vi.spyOn(modal, 'openLogin');
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Drive a real login through the mock backend so the session state is genuine. */
  function login(claims: Partial<JwtClaims> = {}): void {
    auth.login({ email: 'user@test.com', password: 'pw' }).subscribe();
    httpMock
      .expectOne((req) => req.url === `${environment.apiUrl}/auth/login`)
      .flush({ accessToken: makeToken(claims) });
  }

  it('denies unauthenticated navigation and opens the login modal', () => {
    const result = guard.canActivate(snapshotWithData({}), {} as never);

    expect(result).toBe(false);
    expect(openLoginSpy).toHaveBeenCalledTimes(1);
  });

  it('allows authenticated navigation without role requirements', () => {
    login({ role: 'ROLE_USER' });

    expect(guard.canActivate(snapshotWithData({}), {} as never)).toBe(true);
    expect(openLoginSpy).not.toHaveBeenCalled();
  });

  it('allows navigation with an expired access token while a session is active', () => {
    login({ role: 'ROLE_USER', exp: Math.floor(Date.now() / 1000) - 10 });

    expect(guard.canActivate(snapshotWithData({}), {} as never)).toBe(true);
    expect(openLoginSpy).not.toHaveBeenCalled();
  });

  it('denies a role mismatch silently (no login modal)', () => {
    login({ role: 'ROLE_USER' });

    const result = guard.canActivate(snapshotWithData({ roles: ['ROLE_ADMIN'] }), {} as never);

    expect(result).toBe(false);
    expect(openLoginSpy).not.toHaveBeenCalled();
  });

  it('allows navigation when the role matches route.data.roles', () => {
    login({ role: 'ROLE_ADMIN' });

    expect(guard.canActivate(snapshotWithData({ roles: ['ROLE_ADMIN'] }), {} as never)).toBe(true);
  });

  it('authGuard honors route.data.roles via the functional wrapper', () => {
    login({ role: 'ROLE_ADMIN' });
    const snapshot = snapshotWithData({ roles: ['ROLE_ADMIN'] });

    const result = TestBed.runInInjectionContext(() => authGuard(snapshot, {} as never));

    expect(result).toBe(true);
  });
});
