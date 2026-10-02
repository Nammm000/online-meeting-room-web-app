import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { translations } from 'i18n/translations';
import type { Language, TranslationKey } from 'i18n/translations';

/**
 * Two-state UI language. Resolution: stored explicit choice → English.
 * ONLY setLanguage persists (localStorage 'asset-manager.language', values
 * 'en' | 'vi' — same key convention as ThemeService's 'asset-manager.theme').
 *
 * Unlike the theme, no index.html no-flash script is needed: every translated
 * string is rendered by Angular, and the signal read inside t() re-renders
 * templates on switch. The static lang="en" in index.html stays the SSR
 * default; the attribute is corrected here at bootstrap when 'vi' is stored.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'asset-manager.language';

  private readonly _language = signal<Language>(this.resolveInitialLanguage());
  readonly language = this._language.asReadonly();
  readonly isVietnamese = computed(() => this._language() === 'vi');

  constructor() {
    // Browser-only side effect; idempotent with index.html's lang="en".
    if (isPlatformBrowser(this.platformId)) {
      this.applyLanguage(this._language());
    }
  }

  /** Explicit choice: applies AND persists — the only path that writes storage. */
  setLanguage(language: Language): void {
    this._language.set(language);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.applyLanguage(language);
    localStorage.setItem(this.storageKey, language);
  }

  /**
   * Reads the language signal — called from templates, so views relabel
   * live when the language switches.
   */
  t(key: TranslationKey): string {
    return translations[this._language()][key];
  }

  private resolveInitialLanguage(): Language {
    if (!isPlatformBrowser(this.platformId)) {
      return 'en';
    }
    return localStorage.getItem(this.storageKey) === 'vi' ? 'vi' : 'en';
  }

  private applyLanguage(language: Language): void {
    document.documentElement.setAttribute('lang', language);
  }
}
