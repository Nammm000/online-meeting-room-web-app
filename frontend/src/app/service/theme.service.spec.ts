import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Theme, ThemeService } from 'service/theme.service';

const THEME_KEY = 'asset-manager.theme';

// jsdom does not implement matchMedia — stub it, capturing change listeners so
// tests can emit OS-level preference flips.
let changeListeners: ((event: { matches: boolean }) => void)[] = [];

function installMatchMedia(matches: boolean): void {
  changeListeners = [];
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      changeListeners.push(listener),
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function emitSystemChange(matches: boolean): void {
  for (const listener of changeListeners) {
    listener({ matches });
  }
}

function cleanup(): void {
  localStorage.removeItem(THEME_KEY);
  document.documentElement.removeAttribute('data-theme');
}

function createService(): ThemeService {
  TestBed.configureTestingModule({});
  return TestBed.inject(ThemeService);
}

describe('ThemeService', () => {
  afterEach(cleanup);

  it('defaults to dark when the system prefers dark and nothing is stored', () => {
    cleanup();
    installMatchMedia(true);

    const service = createService();

    expect(service.theme()).toBe('dark');
    expect(service.isDark()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('defaults to light when the system prefers light and nothing is stored', () => {
    cleanup();
    installMatchMedia(false);

    const service = createService();

    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it("a stored 'dark' wins over a light system preference", () => {
    cleanup();
    localStorage.setItem(THEME_KEY, 'dark');
    installMatchMedia(false);

    expect(createService().theme()).toBe('dark');
  });

  it("a stored 'light' wins over a dark system preference", () => {
    cleanup();
    localStorage.setItem(THEME_KEY, 'light');
    installMatchMedia(true);

    expect(createService().theme()).toBe('light');
  });

  it('ignores a garbage stored value and falls back to the system preference', () => {
    cleanup();
    localStorage.setItem(THEME_KEY, 'blue');
    installMatchMedia(true);

    expect(createService().theme()).toBe('dark');
  });

  it('toggle() flips the theme, applies it, and persists the choice', () => {
    cleanup();
    installMatchMedia(false);

    const service = createService();
    service.toggle();

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    service.toggle();

    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('follows OS theme changes live while no explicit choice is stored', () => {
    cleanup();
    installMatchMedia(false);

    const service = createService();
    emitSystemChange(true);

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    // Following the OS is not a choice — nothing is persisted.
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('stops following OS changes after an explicit toggle', () => {
    cleanup();
    installMatchMedia(false);

    const service = createService();
    service.toggle(); // persists 'dark'
    emitSystemChange(false);

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('is a no-op on the server platform (light default, no attribute, no storage)', () => {
    cleanup();
    installMatchMedia(true);

    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const service = TestBed.inject(ThemeService);

    const theme: Theme = service.theme();
    expect(theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
