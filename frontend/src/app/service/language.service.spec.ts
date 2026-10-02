import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LanguageService } from 'service/language.service';

const LANGUAGE_KEY = 'asset-manager.language';

function cleanup(): void {
  localStorage.removeItem(LANGUAGE_KEY);
  document.documentElement.removeAttribute('lang');
}

function createService(): LanguageService {
  TestBed.configureTestingModule({});
  return TestBed.inject(LanguageService);
}

describe('LanguageService', () => {
  afterEach(cleanup);

  it('defaults to English when nothing is stored', () => {
    cleanup();

    const service = createService();

    expect(service.language()).toBe('en');
    expect(service.isVietnamese()).toBe(false);
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it("a stored 'vi' wins over the English default", () => {
    cleanup();
    localStorage.setItem(LANGUAGE_KEY, 'vi');

    const service = createService();

    expect(service.language()).toBe('vi');
    expect(service.isVietnamese()).toBe(true);
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
  });

  it('ignores a garbage stored value and falls back to English', () => {
    cleanup();
    localStorage.setItem(LANGUAGE_KEY, 'fr');

    expect(createService().language()).toBe('en');
  });

  it('setLanguage applies, persists, and round-trips', () => {
    cleanup();

    const service = createService();
    service.setLanguage('vi');

    expect(service.language()).toBe('vi');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('vi');

    service.setLanguage('en');

    expect(service.language()).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('en');
  });

  it('t() returns the English text by default and Vietnamese after a switch', () => {
    cleanup();

    const service = createService();
    expect(service.t('menu.users')).toBe('Users');

    service.setLanguage('vi');

    expect(service.t('menu.users')).toBe('Người dùng');
  });

  it('is a no-op on the server platform (English default, no attribute, no storage)', () => {
    cleanup();

    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const service = TestBed.inject(LanguageService);

    expect(service.language()).toBe('en');
    service.setLanguage('vi');
    expect(service.language()).toBe('vi');
    expect(document.documentElement.getAttribute('lang')).toBeNull();
    expect(localStorage.getItem(LANGUAGE_KEY)).toBeNull();
  });
});
