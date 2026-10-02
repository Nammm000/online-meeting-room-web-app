import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { UserSetting } from './user-setting';
import { AuthService } from 'service/auth.service';
import { ModalService } from 'service/modal.service';
import type { UserWrapper } from 'model/user.model';

// jsdom implements neither static — the upload path creates object URLs.
const createObjectURL = vi.fn(() => 'blob:mock-1');
const revokeObjectURL = vi.fn();

const AVATAR_URL = `${environment.apiUrl}/images/avatar`;

const currentUser = (overrides: Partial<UserWrapper> = {}): UserWrapper => ({
  id: 1,
  name: 'Test User',
  email: 'user@test.com',
  phone: '0123456789',
  status: 'true',
  createdTime: '2026-01-01T10:00:00',
  role: 'ROLE_USER',
  accountLevel: { id: 2, code: 'VIP', name: 'VIP', description: null },
  accountNumber: 'ACC-001',
  ...overrides,
});

describe('UserSetting', () => {
  let component: UserSetting;
  let fixture: ComponentFixture<UserSetting>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.removeItem('asset-manager.avatar');
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    await TestBed.configureTestingModule({
      imports: [UserSetting],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(UserSetting);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    httpMock.verify();
    localStorage.removeItem('asset-manager.avatar');
  });

  const flushCurrentUser = (user: UserWrapper, status = 200) =>
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${environment.apiUrl}/users/current-user`)
      .flush(user, { status, statusText: status === 200 ? 'OK' : 'Error' });

  const fileInput = (): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]')!;

  /** Simulates picking a file: seeds input.files, fires change, forces a render. */
  const pickFile = (file: File): void => {
    const input = fileInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  const avatarPost = () => httpMock.expectOne((r) => r.method === 'POST' && r.url === AVATAR_URL);

  it('loads the current user on init', () => {
    flushCurrentUser(currentUser());

    expect(component.profile()?.email).toBe('user@test.com');
    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).toBe('');
  });

  it('surfaces the API error message on failure', () => {
    flushCurrentUser(currentUser(), 403);

    expect(component.profile()).toBeNull();
    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).not.toBe('');
  });

  it('keeps account-level fields optional (admin list shape)', () => {
    flushCurrentUser(currentUser({ accountLevel: undefined, accountNumber: null }));

    expect(component.profile()?.accountNumber).toBeNull();
  });

  it('opens the change-password modal from the quick action', () => {
    flushCurrentUser(currentUser());

    component.openChangePassword();

    expect(TestBed.inject(ModalService).isChangePasswordVisible()).toBe(true);
  });

  it('uploads a selected avatar, refreshes it, and shows success', () => {
    flushCurrentUser(currentUser());
    fixture.detectChanges();

    const file = new File(['png-bytes'], 'avatar.png', { type: 'image/png' });
    pickFile(file);

    const post = avatarPost();
    // Multipart field name and boundary-less header (HttpClient derives both).
    expect(post.request.body instanceof FormData).toBe(true);
    expect((post.request.body as FormData).get('file')).toBe(file);
    expect(post.request.headers.get('Content-Type')).toBeNull();
    // Busy gates the actions and the input is reset for a same-file re-pick.
    expect(component.avatarBusy()).toBe(true);
    expect(fileInput().value).toBe('');
    expect((fixture.nativeElement as HTMLElement).querySelector('.settings-avatar-edit')!.hasAttribute('disabled')).toBe(true);

    post.flush({ id: 7, contentType: 'image/png', fileSize: 9 });
    // The upload response is metadata only — the page re-fetches the bytes.
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === AVATAR_URL)
      .flush(new Blob(['png-bytes'], { type: 'image/png' }));
    fixture.detectChanges();

    expect(TestBed.inject(AuthService).avatarUrl()).toBe('blob:mock-1');
    expect(component.avatarBusy()).toBe(false);
    expect(component.avatarSuccess()).toBe('Avatar updated.');
  });

  it('rejects an oversized file with no HTTP at all', () => {
    flushCurrentUser(currentUser());
    fixture.detectChanges();

    pickFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));

    expect(component.avatarError()).toBe('Image must be smaller than 5MB.');
    expect(component.avatarBusy()).toBe(false);
    httpMock.expectNone((r) => r.method === 'POST' && r.url === AVATAR_URL);
  });

  it('rejects a disallowed file type with no HTTP at all', () => {
    flushCurrentUser(currentUser());
    fixture.detectChanges();

    pickFile(new File(['gif-bytes'], 'avatar.gif', { type: 'image/gif' }));

    expect(component.avatarError()).toBe('Only png, jpeg and webp images are allowed.');
    httpMock.expectNone((r) => r.method === 'POST' && r.url === AVATAR_URL);
  });

  it('surfaces the server error when the upload fails', () => {
    flushCurrentUser(currentUser());
    fixture.detectChanges();

    pickFile(new File(['png-bytes'], 'avatar.png', { type: 'image/png' }));
    avatarPost().flush({ status: 400, message: 'Only png, jpeg and webp images are allowed.', timeStamp: 1 }, { status: 400, statusText: 'Bad Request' });

    expect(component.avatarError()).toBe('Only png, jpeg and webp images are allowed.');
    expect(component.avatarBusy()).toBe(false);
    httpMock.expectNone((r) => r.method === 'GET' && r.url === AVATAR_URL);
  });

  it('shows the remove action only when an avatar exists', () => {
    flushCurrentUser(currentUser());
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.settings-button--danger')).toBeFalsy();

    TestBed.inject(AuthService).setAvatarUrl('blob:mock-1');
    fixture.detectChanges();

    expect(element.querySelector('.settings-button--danger')).toBeTruthy();
  });

  it('removes the avatar through the confirmation dialog', () => {
    flushCurrentUser(currentUser());
    TestBed.inject(AuthService).setAvatarUrl('blob:mock-1');
    fixture.detectChanges();

    component.confirmRemoveAvatar();
    const request = TestBed.inject(ModalService).confirmation();
    expect(request?.danger).toBe(true);

    request!.onConfirm();
    expect(component.avatarBusy()).toBe(true);
    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url === AVATAR_URL)
      .flush({ messag: 'Avatar deleted successfully' });
    fixture.detectChanges();

    expect(TestBed.inject(AuthService).avatarUrl()).toBeNull();
    expect(component.avatarSuccess()).toBe('Avatar removed.');
    expect((fixture.nativeElement as HTMLElement).querySelector('.settings-button--danger')).toBeFalsy();
  });

  it('treats a remove 404 as success (already deleted elsewhere)', () => {
    flushCurrentUser(currentUser());
    TestBed.inject(AuthService).setAvatarUrl('blob:mock-1');
    fixture.detectChanges();

    component.confirmRemoveAvatar();
    TestBed.inject(ModalService).confirmation()!.onConfirm();
    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url === AVATAR_URL)
      .flush(null, { status: 404, statusText: 'Not Found' });

    expect(component.avatarBusy()).toBe(false);
    expect(component.avatarError()).toBe('');
    expect(component.avatarSuccess()).toBe('Avatar removed.');
    expect(TestBed.inject(AuthService).avatarUrl()).toBeNull();
  });

  it('keeps the avatar when removal fails', () => {
    flushCurrentUser(currentUser());
    TestBed.inject(AuthService).setAvatarUrl('blob:mock-1');
    fixture.detectChanges();

    component.confirmRemoveAvatar();
    TestBed.inject(ModalService).confirmation()!.onConfirm();
    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url === AVATAR_URL)
      .flush({ status: 500, message: 'Boom', timeStamp: 1 }, { status: 500, statusText: 'Server Error' });

    expect(component.avatarBusy()).toBe(false);
    expect(component.avatarError()).toBe('Boom');
    expect(TestBed.inject(AuthService).avatarUrl()).toBe('blob:mock-1');
  });
});
