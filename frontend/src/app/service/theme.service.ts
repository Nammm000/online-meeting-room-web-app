import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

/**
 * Two-state theme state. Resolution: stored explicit choice → OS preference → light.
 * ONLY an explicit toggle persists (setTheme/toggle write localStorage); the OS
 * preference is followed live (matchMedia change listener) until the first
 * explicit choice is stored, after which the listener is disarmed.
 *
 * Convention shared with the no-flash inline script in index.html and
 * src/scss/theme.scss (they cannot import this constant — keep in sync):
 *   localStorage key 'asset-manager.theme' (values 'light' | 'dark')
 *   attribute data-theme on document.documentElement
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'asset-manager.theme';

  private readonly _theme = signal<Theme>(this.resolveInitialTheme());
  readonly theme = this._theme.asReadonly();
  readonly isDark = computed(() => this._theme() === 'dark');

  constructor() {
    // Browser-only side effects. The inline script in index.html already set
    // the attribute pre-paint with identical resolution logic; re-applying is
    // idempotent and sets up the OS-change listener.
    if (isPlatformBrowser(this.platformId)) {
      this.applyTheme(this._theme());
      this.listenForSystemChanges();
    }
  }

  toggle(): void {
    this.setTheme(this._theme() === 'dark' ? 'light' : 'dark');
  }

  /** Explicit choice: applies AND persists — the only path that writes storage. */
  setTheme(theme: Theme): void {
    this._theme.set(theme);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.applyTheme(theme);
    localStorage.setItem(this.storageKey, theme);
  }

  private resolveInitialTheme(): Theme {
    if (!isPlatformBrowser(this.platformId)) {
      return 'light';
    }
    const stored = localStorage.getItem(this.storageKey);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return this.systemPrefersDark() ? 'dark' : 'light';
  }

  // typeof guard: jsdom does not implement matchMedia — without it, merely
  // instantiating this service in unit tests would throw.
  private systemPrefersDark(): boolean {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  /**
   * Follow OS-level theme changes live while the user has never made an
   * explicit choice. The listener stays attached for the app's lifetime (root
   * service — no leak) and self-disarms: any stored value short-circuits it,
   * and toggle() always stores.
   */
  private listenForSystemChanges(): void {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      if (localStorage.getItem(this.storageKey) !== null) {
        return;
      }
      this._theme.set(event.matches ? 'dark' : 'light');
      this.applyTheme(this._theme());
    });
  }
}
