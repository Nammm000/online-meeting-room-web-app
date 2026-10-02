import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { AuthService } from 'service/auth.service';
import { UserImageService } from 'service/user-image.service';
import type { JwtClaims } from 'util/jwt-util';

// jsdom implements neither static — install mocks for the service's
// URL.createObjectURL/revokeObjectURL usage (FakeWebSocket precedent).
let blobSeq = 0;
const createObjectURL = vi.fn(() => `blob:mock-${++blobSeq}`);
const revokeObjectURL = vi.fn();

const AVATAR_URL = `${environment.apiUrl}/images/avatar`;

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

const PNG_BLOB = () => new Blob(['png-bytes'], { type: 'image/png' });

describe('UserImageService', () => {
  let httpMock: HttpTestingController;
  let authService: AuthService;
  let service: UserImageService;

  const expectAvatarRequest = (method: 'GET' | 'POST' | 'DELETE') =>
    httpMock.expectOne((r) => r.method === method && r.url === AVATAR_URL);

  beforeEach(async () => {
    localStorage.clear();
    blobSeq = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService);
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(TestBed.inject(UserImageService)).toBeTruthy();
  });

  it('uploads the file as multipart field "file" without a manual Content-Type', () => {
    service = TestBed.inject(UserImageService);
    const file = new File(['png-bytes'], 'avatar.png', { type: 'image/png' });
    const emitted: unknown[] = [];
    service.uploadAvatar(file).subscribe((value) => emitted.push(value));

    const req = expectAvatarRequest('POST');
    // HttpClient must derive the multipart boundary itself — a preset header would break it.
    expect(req.request.headers.get('Content-Type')).toBeNull();
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({ id: 7, contentType: 'image/png', fileSize: 9 });

    expect(emitted).toEqual([{ id: 7, contentType: 'image/png', fileSize: 9 }]);
  });

  it('fetches the avatar bytes as a blob', () => {
    service = TestBed.inject(UserImageService);
    const emitted: Blob[] = [];
    service.getAvatar().subscribe((value) => emitted.push(value));

    const req = expectAvatarRequest('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(PNG_BLOB());

    expect(emitted[0]?.type).toBe('image/png');
  });

  it('deletes the avatar and emits the message response', () => {
    service = TestBed.inject(UserImageService);
    const emitted: unknown[] = [];
    service.deleteAvatar().subscribe((value) => emitted.push(value));

    expectAvatarRequest('DELETE').flush({ messag: 'Avatar deleted successfully' });

    // The misspelled key round-trips as MessageResponse (backend quirk).
    expect(emitted).toEqual([{ messag: 'Avatar deleted successfully' }]);
  });

  it('does not hydrate until a session is active', () => {
    service = TestBed.inject(UserImageService);
    TestBed.flushEffects();

    httpMock.expectNone((r) => r.method === 'GET' && r.url === AVATAR_URL);
    expect(authService.avatarUrl()).toBeNull();
  });

  it('hydrates the avatar as an object URL on session start', () => {
    service = TestBed.inject(UserImageService);
    TestBed.flushEffects();
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    TestBed.flushEffects();

    expectAvatarRequest('GET').flush(PNG_BLOB());

    expect(authService.avatarUrl()).toBe('blob:mock-1');
    expect(revokeObjectURL).not.toHaveBeenCalled(); // first URL — nothing to revoke
  });

  it('re-hydrates on re-login and revokes the previous object URL', () => {
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    service = TestBed.inject(UserImageService);
    TestBed.flushEffects();
    expectAvatarRequest('GET').flush(PNG_BLOB());

    // End the session (sessionExpired clears it without the logout HTTP dance).
    authService.sessionExpired();
    TestBed.flushEffects();
    authService.applyAuthenticationResponse({ accessToken: makeToken({ sub: 'other@test.com' }) });
    TestBed.flushEffects();

    expectAvatarRequest('GET').flush(PNG_BLOB());

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(authService.avatarUrl()).toBe('blob:mock-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('clears the avatar (and any legacy seed) when the server answers 404', () => {
    authService.setAvatarUrl('https://example.com/seed.png'); // legacy manually-seeded URL
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    service = TestBed.inject(UserImageService);
    TestBed.flushEffects();

    expectAvatarRequest('GET').flush(null, { status: 404, statusText: 'Not Found' });

    expect(authService.avatarUrl()).toBeNull();
    expect(localStorage.getItem('asset-manager.avatar')).toBeNull();
  });

  it('keeps the current avatar on non-404 hydration failures (transient blip)', () => {
    authService.setAvatarUrl('https://example.com/seed.png');
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    service = TestBed.inject(UserImageService);
    TestBed.flushEffects();

    expectAvatarRequest('GET').flush(null, { status: 500, statusText: 'Server Error' });

    expect(authService.avatarUrl()).toBe('https://example.com/seed.png');
  });

  it('refreshAvatar re-fetches the bytes and revokes the replaced URL', () => {
    service = TestBed.inject(UserImageService);
    service.refreshAvatar();

    expectAvatarRequest('GET').flush(PNG_BLOB());
    expect(authService.avatarUrl()).toBe('blob:mock-1');

    service.refreshAvatar();
    expectAvatarRequest('GET').flush(PNG_BLOB());

    expect(authService.avatarUrl()).toBe('blob:mock-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('clearAvatar revokes the managed URL and clears the signal; never an unmanaged one', () => {
    authService.setAvatarUrl('https://example.com/seed.png');
    service = TestBed.inject(UserImageService);
    service.clearAvatar();

    // The https seed was not created by this service — nothing to revoke.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(authService.avatarUrl()).toBeNull();

    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    TestBed.flushEffects();
    expectAvatarRequest('GET').flush(PNG_BLOB());
    service.clearAvatar();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    expect(authService.avatarUrl()).toBeNull();
  });

  it('never issues HTTP on the server (SSR/prerender)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController); // from the fresh injector
    const serverAuth = TestBed.inject(AuthService);
    serverAuth.applyAuthenticationResponse({ accessToken: makeToken() });
    TestBed.inject(UserImageService);
    TestBed.flushEffects();

    httpMock.expectNone((r) => r.method === 'GET' && r.url === AVATAR_URL);
    expect(serverAuth.avatarUrl()).toBeNull();
  });
});
