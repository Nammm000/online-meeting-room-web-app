import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { UserPdfFileService } from 'service/user-pdf-file.service';

const BASE_URL = `${environment.apiUrl}/pdf-files`;

describe('UserPdfFileService', () => {
  let httpMock: HttpTestingController;
  let service: UserPdfFileService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(UserPdfFileService);
  });

  afterEach(() => httpMock.verify());

  it('uploads every file as repeated multipart field "files" without a manual Content-Type', () => {
    const first = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const emitted: unknown[] = [];
    service.upload([first, second]).subscribe((value) => emitted.push(value));

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);
    // HttpClient must derive the multipart boundary itself — a preset header would break it.
    expect(req.request.headers.get('Content-Type')).toBeNull();
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).getAll('files')).toEqual([first, second]);
    req.flush([]);
    expect(emitted).toEqual([[]]);
  });

  it('lists the paged files with page/size params', () => {
    const emitted: unknown[] = [];
    service.getAll(2, 5).subscribe((value) => emitted.push(value));

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url === BASE_URL);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe('5');
    req.flush({
      content: [],
      page: 2,
      size: 5,
      totalElements: 0,
      totalPages: 0,
      first: false,
      last: true,
    });
    expect((emitted[0] as { page: number }).page).toBe(2);
  });

  it('downloads a file as a blob', () => {
    const emitted: Blob[] = [];
    service.download(7).subscribe((value) => emitted.push(value));

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/7`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
    expect(emitted[0].size).toBe(9);
  });

  it('deletes a file and round-trips the misspelled message key', () => {
    const emitted: unknown[] = [];
    service.delete(7).subscribe((value) => emitted.push(value));

    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url === `${BASE_URL}/7`)
      .flush({ messag: 'PDF file deleted successfully' });
    expect(emitted).toEqual([{ messag: 'PDF file deleted successfully' }]);
  });
});
