import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { Header } from './header';
import { ModalService } from 'service/modal.service';
import { AuthService } from 'service/auth.service';
import { NotificationService } from 'service/notification.service';
import { UserImageService } from 'service/user-image.service';
import type { Notification } from 'model/notification.model';
import type { JwtClaims } from 'util/jwt-util';

const STORAGE_KEY = 'asset-manager.token';
const AVATAR_KEY = 'asset-manager.avatar';
const THEME_KEY = 'asset-manager.theme';
const LANGUAGE_KEY = 'asset-manager.language';

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

// The header only reads the service's signals and calls its two mutators — a
// fake keeps this spec decoupled from WebSockets (jsdom has none).
function makeNotificationFake() {
  return {
    notifications: signal<Notification[]>([]),
    unreadCount: signal(0),
    connected: signal(false),
    markAllRead: vi.fn(),
    clearAll: vi.fn(),
  };
}
type NotificationFake = ReturnType<typeof makeNotificationFake>;

describe('Header (logged out)', () => {
  let component: Header;
  let fixture: ComponentFixture<Header>;
  let httpMock: HttpTestingController;
  let notificationFake: NotificationFake;

  beforeEach(async () => {
    localStorage.removeItem(AVATAR_KEY);
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(LANGUAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('lang');
    notificationFake = makeNotificationFake();
    await TestBed.configureTestingModule({
      imports: [Header],
      // provideRouter: the dropdown's Settings link uses routerLink/routerLinkActive
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: notificationFake },
        // The header injects UserImageService only for its avatar-hydration side
        // effect — faked here so the seeded session in the logged-in describe
        // doesn't fire a real GET /images/avatar.
        { provide: UserImageService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Header);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(AVATAR_KEY);
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(LANGUAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('lang');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows Login and Sign Up buttons and the hamburger, no avatar', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.btn--login')).toBeTruthy();
    expect(element.querySelector('.btn--signup')).toBeTruthy();
    expect(element.querySelector('.header__hamburger')).toBeTruthy();
    expect(element.querySelector('.header__avatar-btn')).toBeFalsy();
    expect(element.querySelector('.header__dropdown')).toBeFalsy();
  });

  it('shows no notification bell for guests', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.header__bell-btn')).toBeFalsy();
    expect(element.querySelector('.header__bell-dropdown')).toBeFalsy();
  });

  const themeToggle = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.header__theme-toggle')!;

  it('renders the theme toggle (moon icon, switch-to-dark label) for guests', () => {
    // jsdom has no matchMedia, so the service defaults to light.
    const icon = themeToggle().querySelector('i');

    expect(themeToggle().getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(icon?.classList.contains('moon')).toBe(true);
    expect(icon?.classList.contains('icon-18')).toBe(true);
  });

  it('clicking the toggle switches to dark, persists it, and flips icon and label', () => {
    themeToggle().click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(themeToggle().getAttribute('aria-label')).toBe('Switch to light theme');
    expect(themeToggle().querySelector('i')?.classList.contains('sun')).toBe(true);

    themeToggle().click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(themeToggle().querySelector('i')?.classList.contains('moon')).toBe(true);
  });
});

describe('Header (logged in)', () => {
  let component: Header;
  let fixture: ComponentFixture<Header>;
  let httpMock: HttpTestingController;
  let notificationFake: NotificationFake;

  beforeEach(async () => {
    localStorage.removeItem(AVATAR_KEY);
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(LANGUAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('lang');
    notificationFake = makeNotificationFake();
    await TestBed.configureTestingModule({
      imports: [Header],
      // provideRouter: the dropdown's Settings link uses routerLink/routerLinkActive
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: notificationFake },
        // The header injects UserImageService only for its avatar-hydration side
        // effect — faked here so the seeded session in the logged-in describe
        // doesn't fire a real GET /images/avatar.
        { provide: UserImageService, useValue: {} },
      ],
    }).compileComponents();

    // Seed the in-memory session before the fixture reads it (tokens are never persisted).
    TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken({ sub: 'user@test.com' }) });
    fixture = TestBed.createComponent(Header);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(AVATAR_KEY);
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(LANGUAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('lang');
  });

  const avatarButton = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.header__avatar-btn')!;

  const bellButton = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.header__bell-btn')!;

  it('renders the bell with the bell glyph, no badge, no dropdown', () => {
    const element: HTMLElement = fixture.nativeElement;
    const icon = bellButton().querySelector('i');

    expect(bellButton().getAttribute('aria-label')).toBe('Notifications');
    expect(icon?.classList.contains('icon-18')).toBe(true);
    expect(icon?.classList.contains('bell')).toBe(true);
    expect(element.querySelector('.header__bell-badge')).toBeFalsy();
    expect(element.querySelector('.header__bell-dropdown')).toBeFalsy();
  });

  it('shows the unread badge, capping the label at 9+', () => {
    notificationFake.unreadCount.set(10);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.header__bell-badge')?.textContent?.trim(),
    ).toBe('9+');

    notificationFake.unreadCount.set(3);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.header__bell-badge')?.textContent?.trim(),
    ).toBe('3');

    notificationFake.unreadCount.set(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__bell-badge')).toBeFalsy();
  });

  it('opens the bell dropdown on click, marks all read, and lists notifications', () => {
    notificationFake.notifications.set([
      { message: 'Reminder: please review your assets.', timestamp: '2026-09-12T08:30:00Z' },
    ]);
    bellButton().click();
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.header__bell-dropdown')).toBeTruthy();
    expect(bellButton().getAttribute('aria-expanded')).toBe('true');
    expect(notificationFake.markAllRead).toHaveBeenCalled();
    expect(
      element.querySelector('.header__bell-item-message')?.textContent?.trim(),
    ).toBe('Reminder: please review your assets.');
    // Only presence asserted: DatePipe output is timezone/locale dependent.
    expect(element.querySelector('time.header__bell-item-time')).toBeTruthy();
  });

  it('shows the empty state when no notifications exist', () => {
    bellButton().click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.header__bell-empty')?.textContent?.trim(),
    ).toBe('No notifications yet');
  });

  it('clears all from the dropdown, keeping it open on the empty state', () => {
    bellButton().click();
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.header__bell-clear')!.click();
    fixture.detectChanges();

    expect(notificationFake.clearAll).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.header__bell-dropdown')).toBeTruthy();
  });

  it('keeps only one header dropdown open at a time', () => {
    avatarButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeTruthy();

    bellButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.header__bell-dropdown')).toBeTruthy();

    avatarButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.header__bell-dropdown')).toBeFalsy();
  });

  it('closes the bell dropdown on Escape and outside click', () => {
    bellButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__bell-dropdown')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__bell-dropdown')).toBeFalsy();

    bellButton().click();
    fixture.detectChanges();
    document.body.click(); // outside the header element
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__bell-dropdown')).toBeFalsy();
  });

  it('replaces buttons and hamburger with the avatar showing the email initial', () => {
    const element: HTMLElement = fixture.nativeElement;
    const initials = element.querySelector<HTMLElement>('.header__avatar-initials');

    expect(element.querySelector('.header__avatar-btn')).toBeTruthy();
    expect(initials?.textContent).toBe('U');
    expect(element.querySelector('img.header__avatar-img')).toBeFalsy();
    expect(element.querySelector('.btn--login')).toBeFalsy();
    expect(element.querySelector('.btn--signup')).toBeFalsy();
    expect(element.querySelector('.header__hamburger')).toBeFalsy();
  });

  it('renders the theme toggle alongside the avatar', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('.header__theme-toggle')).toBeTruthy();
    expect(element.querySelector('.header__avatar-btn')).toBeTruthy();
  });

  it('renders the stored avatar image instead of the initials', () => {
    TestBed.inject(AuthService).setAvatarUrl('https://example.com/me.png');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const img = element.querySelector<HTMLImageElement>('img.header__avatar-img');

    expect(img?.src).toBe('https://example.com/me.png');
    expect(element.querySelector('.header__avatar-initials')).toBeFalsy();
  });

  it('falls back to initials when the avatar image fails to load', () => {
    TestBed.inject(AuthService).setAvatarUrl('https://example.com/me.png');
    fixture.detectChanges();
    component.onAvatarError();
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('img.header__avatar-img')).toBeFalsy();
    expect(element.querySelector<HTMLElement>('.header__avatar-initials')?.textContent).toBe('U');
  });

  it('opens the dropdown on avatar click and closes it on Escape / outside click', () => {
    avatarButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeTruthy();
    expect(avatarButton().getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeFalsy();

    avatarButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeTruthy();

    document.body.click(); // outside the header element
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header__dropdown')).toBeFalsy();
  });

  it('opens the change-password modal from the dropdown', () => {
    avatarButton().click();
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    // The dropdown has more than one non-danger item (Settings link first) —
    // target the change-password entry by its label.
    const item = Array.from(element.querySelectorAll<HTMLElement>('.header__dropdown-item')).find(
      (el) => el.textContent?.trim() === 'Change Password',
    )!;
    item.click();
    fixture.detectChanges();

    expect(TestBed.inject(ModalService).isChangePasswordVisible()).toBe(true);
    expect(element.querySelector('.header__dropdown')).toBeFalsy();
  });

  it('renders the language section as a label + select with both options', () => {
    avatarButton().click();
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const label = element.querySelector<HTMLLabelElement>('.header__dropdown-label')!;
    const select = element.querySelector<HTMLSelectElement>('.header__dropdown-select')!;
    const options = Array.from(select.options);

    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('for')).toBe('header-language');
    expect(label.textContent?.trim()).toBe('Language');
    expect(select.id).toBe('header-language');
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Tiếng Việt', 'English']);
    expect(options.map((option) => option.value)).toEqual(['vi', 'en']);
    // English is the default.
    expect(select.value).toBe('en');
  });

  it('switching to Vietnamese persists, relabels the menu live, and keeps the dropdown open', () => {
    avatarButton().click();
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const select = element.querySelector<HTMLSelectElement>('.header__dropdown-select')!;
    select.value = 'vi';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('vi');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
    // The dropdown stays open so the relabel is visible.
    expect(element.querySelector('.header__dropdown')).toBeTruthy();
    const labels = Array.from(
      element.querySelectorAll<HTMLElement>('.header__dropdown-item'),
    ).map((item) => item.textContent?.trim());
    expect(labels).toContain('Cài đặt');
    expect(labels).toContain('Đổi mật khẩu');
    expect(labels).toContain('Đăng xuất');
    // The section label (not a menu item) relabels too, and the select follows.
    expect(
      element.querySelector('.header__dropdown-label')?.textContent?.trim(),
    ).toBe('Ngôn ngữ');
    expect(select.value).toBe('vi');
  });

  it('logs out from the dropdown, flips back to buttons, and keeps the avatar key', () => {
    localStorage.setItem(AVATAR_KEY, 'https://example.com/me.png');

    const element: HTMLElement = fixture.nativeElement;
    avatarButton().click();
    fixture.detectChanges();
    element.querySelector<HTMLElement>('.header__dropdown-item--danger')!.click();

    const logout = httpMock.expectOne((req) => req.url === `${environment.apiUrl}/auth/logout`);
    // No body: the HttpOnly cookie identifies the token; the request is credentialed.
    expect(logout.request.body).toBeNull();
    expect(logout.request.withCredentials).toBe(true);
    logout.flush({ message: 'Bye' });
    fixture.detectChanges();

    expect(element.querySelector('.btn--login')).toBeTruthy();
    expect(element.querySelector('.header__avatar-btn')).toBeFalsy();
    // Tokens were never persisted, and the avatar deliberately survives logout.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(AVATAR_KEY)).toBe('https://example.com/me.png');
  });
});
