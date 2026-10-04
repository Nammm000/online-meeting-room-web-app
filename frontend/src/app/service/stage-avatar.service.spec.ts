import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { StageAvatarService } from 'service/stage-avatar.service';

// jsdom has no URL.createObjectURL — stub it (the service only needs opaque
// strings). configurable: true is mandatory: the test environment is shared
// with user-image.service.spec, which installs its own stub per test.
let blobCounter = 0;
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => `blob:mock-${blobCounter++}`),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

const avatarUrl = (userId: number) => `${environment.apiUrl}/images/avatar/${userId}`;

describe('StageAvatarService', () => {
  let httpMock: HttpTestingController;
  let service: StageAvatarService;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(StageAvatarService);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('fetches sequentially with a gap between requests', async () => {
    service.ensureLoaded([1, 2]);

    const first = httpMock.expectOne(avatarUrl(1));
    expect(httpMock.match((r) => r.url === avatarUrl(2))).toHaveLength(0); // not yet
    first.flush(new Blob(['a']));

    await vi.advanceTimersByTimeAsync(400); // the inter-request gap
    const second = httpMock.expectOne(avatarUrl(2));
    second.flush(new Blob(['b']));
    await vi.advanceTimersByTimeAsync(400); // drain settles

    expect(service.urlFor(1)).toBe('blob:mock-0');
    expect(service.urlFor(2)).toBe('blob:mock-1');
  });

  it('negative-caches 404s — one fetch per session, initials cover the rest', async () => {
    service.ensureLoaded([7]);
    // A blob-typed request cannot flush a JSON body — flush bytes + status.
    httpMock
      .expectOne(avatarUrl(7))
      .flush(new Blob(['x']), { status: 404, statusText: 'Not Found' });
    await vi.advanceTimersByTimeAsync(400);

    service.ensureLoaded([7]); // the roster poll re-invokes every 2.5 s
    expect(httpMock.match((r) => r.url === avatarUrl(7))).toHaveLength(0);
    expect(service.urlFor(7)).toBeNull();
  });

  it('cools down 30 s on other failures instead of retrying every poll', async () => {
    service.ensureLoaded([8]);
    httpMock.expectOne(avatarUrl(8)).flush(null, { status: 500, statusText: 'Boom' });
    await vi.advanceTimersByTimeAsync(400);

    service.ensureLoaded([8]);
    expect(httpMock.match((r) => r.url === avatarUrl(8))).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(30_000);
    service.ensureLoaded([8]);
    httpMock.expectOne(avatarUrl(8)).flush(new Blob(['c']));
    await vi.advanceTimersByTimeAsync(400);
    expect(service.urlFor(8)).toBe('blob:mock-2');
  });

  it('clearAll revokes every object URL and forgets the cache', async () => {
    service.ensureLoaded([1]);
    httpMock.expectOne(avatarUrl(1)).flush(new Blob(['a']));
    await vi.advanceTimersByTimeAsync(400);

    service.clearAll();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-3');
    expect(service.urlFor(1)).toBeNull();
    service.ensureLoaded([1]); // forgotten → requeued
    httpMock.expectOne(avatarUrl(1));
  });
});
