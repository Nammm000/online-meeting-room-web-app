import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { PdfFiles } from './pdf-files';
import { ModalService } from 'service/modal.service';
import type { UserPdfFile } from 'model/user-pdf-file.model';
import type { PagedResponse } from 'model/paged-response.model';

// jsdom implements neither static — the download path creates object URLs.
const createObjectURL = vi.fn(() => 'blob:mock-1');
const revokeObjectURL = vi.fn();

const BASE_URL = `${environment.apiUrl}/pdf-files`;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const pdfFile = (name: string, overrides: Partial<File> = {}): File =>
  new File(['pdf-bytes'], name, { type: 'application/pdf', ...overrides });

const row = (id: number): UserPdfFile => ({
  id,
  fileName: `doc-${id}.pdf`,
  contentType: 'application/pdf',
  fileSize: 2048,
  createdAt: '2026-09-01T10:00:00',
});

const paged = (content: UserPdfFile[]): PagedResponse<UserPdfFile> => ({
  content,
  page: 0,
  size: 10,
  totalElements: content.length,
  totalPages: 1,
  first: true,
  last: true,
});

describe('PdfFiles', () => {
  let component: PdfFiles;
  let fixture: ComponentFixture<PdfFiles>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    await TestBed.configureTestingModule({
      imports: [PdfFiles],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(PdfFiles);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    httpMock.verify();
  });

  const flushList = (content: UserPdfFile[] = []) =>
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === BASE_URL)
      .flush(paged(content));

  const fileInput = (): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]')!;

  /** Simulates picking files: seeds input.files, fires change, forces a render. */
  const pickFiles = (files: File[]): void => {
    const input = fileInput();
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  /** Simulates a drop — jsdom's DragEvent/DataTransfer are unreliable, so build the event by hand. */
  const dropFiles = (files: File[]): void => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files },
    } as unknown as DragEvent;
    component.onDrop(event);
    fixture.detectChanges();
  };

  const uploadPost = () =>
    httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);

  it('loads the paged list on init', () => {
    flushList([row(1), row(2)]);
    fixture.detectChanges();

    expect(component.rows()).toHaveLength(2);
    expect(component.page()).toBe(0);
    expect(component.totalPages()).toBe(1);
    expect(component.loading()).toBe(false);
  });

  it('surfaces the API error message on list failure', () => {
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === BASE_URL)
      .flush({ status: 500, message: 'Boom', timeStamp: 1 }, { status: 500, statusText: 'Server Error' });

    expect(component.errorMessage()).toBe('Boom');
    expect(component.loading()).toBe(false);
  });

  it('stages multiple picked files without any HTTP', () => {
    flushList();

    pickFiles([pdfFile('a.pdf'), pdfFile('b.pdf')]);

    expect(component.accepted()).toHaveLength(2);
    expect(component.rejections()).toHaveLength(0);
    httpMock.expectNone((r) => r.method === 'POST' && r.url === BASE_URL);
  });

  it('stages files from a drop', () => {
    flushList();

    dropFiles([pdfFile('dropped.pdf')]);

    expect(component.accepted()).toHaveLength(1);
    expect(component.accepted()[0].name).toBe('dropped.pdf');
  });

  it('resets the input so a same-file re-pick re-fires change', () => {
    flushList();

    pickFiles([pdfFile('a.pdf')]);

    expect(fileInput().value).toBe('');
  });

  it('rejects a non-PDF with the localized reason and no HTTP', () => {
    flushList();

    pickFiles([new File(['text'], 'notes.txt', { type: 'text/plain' })]);

    expect(component.accepted()).toHaveLength(0);
    expect(component.rejections()[0]).toEqual({
      name: 'notes.txt',
      reason: 'Only PDF files are allowed.',
    });
    httpMock.expectNone((r) => r.method === 'POST' && r.url === BASE_URL);
  });

  it('accepts a MIME-less .pdf drop (backend extension fallback)', () => {
    flushList();

    pickFiles([new File(['pdf'], 'scan.pdf', { type: '' })]);

    expect(component.accepted()).toHaveLength(1);
    expect(component.rejections()).toHaveLength(0);
  });

  it('rejects an oversized file with the localized reason', () => {
    flushList();

    pickFiles([
      new File([new Uint8Array(MAX_PDF_BYTES + 1)], 'big.pdf', { type: 'application/pdf' }),
    ]);

    expect(component.accepted()).toHaveLength(0);
    expect(component.rejections()[0].reason).toBe('Each file must be smaller than 20MB.');
  });

  it('rejects duplicates by name/size/lastModified', () => {
    flushList();
    // Same name+size+lastModified = same file, regardless of instance
    pickFiles([pdfFile('a.pdf', { lastModified: 1000 })]);
    pickFiles([pdfFile('a.pdf', { lastModified: 1000 })]);

    expect(component.accepted()).toHaveLength(1);
    expect(component.rejections()[0].reason).toBe('Already selected.');
  });

  it('caps the selection at 10 files', () => {
    flushList();

    pickFiles(
      Array.from({ length: 11 }, (_, i) => pdfFile(`doc-${i}.pdf`)),
    );

    expect(component.accepted()).toHaveLength(10);
    expect(component.rejections()).toHaveLength(1);
    expect(component.rejections()[0].reason).toBe(
      'No more than 10 files can be uploaded at once.',
    );
  });

  it('removes a staged file without touching the others', () => {
    flushList();
    pickFiles([pdfFile('a.pdf'), pdfFile('b.pdf')]);

    component.removePending(0);
    fixture.detectChanges();

    expect(component.accepted().map((file) => file.name)).toEqual(['b.pdf']);
  });

  it('uploads all staged files in one request, clears them, and reloads page 0', () => {
    flushList();
    const first = pdfFile('a.pdf');
    const second = pdfFile('b.pdf');
    pickFiles([first, second]);

    component.upload();
    fixture.detectChanges();

    const post = uploadPost();
    expect(component.uploading()).toBe(true);
    expect((post.request.body as FormData).getAll('files')).toEqual([first, second]);
    post.flush([]);
    // Success always restarts at the first page.
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === BASE_URL)
      .flush(paged([row(1)]));
    fixture.detectChanges();

    expect(component.uploading()).toBe(false);
    expect(component.uploadSuccess()).toBe('PDF files uploaded.');
    expect(component.accepted()).toHaveLength(0);
    expect(component.rejections()).toHaveLength(0);
  });

  it('surfaces the server error when the upload fails', () => {
    flushList();
    pickFiles([pdfFile('a.pdf')]);

    component.upload();
    uploadPost().flush(
      { status: 400, message: "File 'a.pdf' is not a PDF", timeStamp: 1 },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(component.uploading()).toBe(false);
    expect(component.uploadError()).toBe("File 'a.pdf' is not a PDF");
    expect(component.accepted()).toHaveLength(1); // staged files survive for a retry
  });

  it('downloads a row as a blob through an anchor click', () => {
    flushList([row(5)]);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    component.download(component.rows()[0]);
    expect(component.downloadingId()).toBe(5);

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/5`)
      .flush(new Blob(['pdf-bytes'], { type: 'application/pdf' }));

    expect(clickSpy).toHaveBeenCalled();
    expect(component.downloadingId()).toBeNull();
    clickSpy.mockRestore();
  });

  it('clears the download busy state on failure', () => {
    flushList([row(5)]);

    component.download(component.rows()[0]);
    // Blob-typed responses can't flush a JSON error body — null lands in the
    // generic fallback of getApiErrorMessage.
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/5`)
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(component.downloadingId()).toBeNull();
    expect(component.errorMessage()).toBe('Something went wrong, Please try again later');
  });

  it('deletes through the confirmation modal and reloads', () => {
    flushList([row(5)]);

    component.confirmDelete(component.rows()[0]);
    const request = TestBed.inject(ModalService).confirmation();
    expect(request?.danger).toBe(true);
    expect(request?.title).toBe('Delete PDF file');

    request!.onConfirm();
    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url === `${BASE_URL}/5`)
      .flush({ messag: 'PDF file deleted successfully' });
    flushList();

    expect(component.errorMessage()).toBe('');
  });

  it('toggles the drag-over highlight on drag events', () => {
    flushList();

    const over = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;
    component.onDragOver(over);
    expect(component.dragOver()).toBe(true);

    // Leaving to outside the zone clears it
    const leave = {
      currentTarget: null,
      relatedTarget: null,
    } as unknown as DragEvent;
    component.onDragLeave(leave);
    expect(component.dragOver()).toBe(false);
  });

  it('shows the empty state when nothing is stored', () => {
    flushList([]);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.empty-state')!.textContent,
    ).toContain('No PDF files uploaded yet.');
  });
});
