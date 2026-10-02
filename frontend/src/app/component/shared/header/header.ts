import { Component, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ModalService } from 'service/modal.service';
import { AuthService } from 'service/auth.service';
import { ThemeService } from 'service/theme.service';
import { LanguageService } from 'service/language.service';
import { NotificationService } from 'service/notification.service';
import { UserImageService } from 'service/user-image.service';
import type { Language } from 'i18n/translations';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  isMobileMenuOpen = signal(false);
  isDropdownOpen = signal(false);
  isNotificationDropdownOpen = signal(false);
  avatarLoadFailed = signal(false);

  private readonly elementRef = inject(ElementRef);

  constructor(
    private modalService: ModalService,
    // protected: referenced directly from the template (strictTemplates forbids private)
    protected authService: AuthService,
    protected themeService: ThemeService,
    protected langService: LanguageService,
    protected notificationService: NotificationService,
    // Injected for its side effect only (NotificationService precedent): the
    // header is mounted on every page, so UserImageService's session effect
    // exists from app start and hydrates the avatarUrl this header renders.
    private userImageService: UserImageService,
  ) {
    // A changed avatar URL (e.g. re-login as someone else) must retry the <img>.
    effect(() => {
      this.authService.avatarUrl();
      this.avatarLoadFailed.set(false);
    });
  }

  // Null-safe: strictTemplates requires handling a null email even though
  // isAuthenticated() implies a sub claim whenever this renders.
  readonly initials = computed(() => this.authService.email()?.charAt(0).toUpperCase() ?? '?');

  // Null when no URL is stored or the <img> errored -> initials fallback.
  readonly avatarSrc = computed(() =>
    this.avatarLoadFailed() ? null : this.authService.avatarUrl(),
  );

  // Badge text — capped so three digits can't overflow the 16px dot.
  readonly unreadLabel = computed(() => {
    const count = this.notificationService.unreadCount();
    return count > 9 ? '9+' : String(count);
  });

  openLogin(): void {
    this.modalService.openLogin();
  }

  openSignup(): void {
    this.modalService.openSignup();
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update((v) => !v);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  toggleDropdown(): void {
    // Only one header dropdown at a time.
    this.closeNotifications();
    this.isDropdownOpen.update((v) => !v);
  }

  closeDropdown(): void {
    this.isDropdownOpen.set(false);
  }

  toggleNotifications(): void {
    this.closeDropdown();
    this.isNotificationDropdownOpen.update((v) => !v);
    // Opening the dropdown is "reading" the notifications.
    if (this.isNotificationDropdownOpen()) {
      this.notificationService.markAllRead();
    }
  }

  closeNotifications(): void {
    this.isNotificationDropdownOpen.set(false);
  }

  clearNotifications(): void {
    this.notificationService.clearAll();
  }

  onAvatarError(): void {
    this.avatarLoadFailed.set(true);
  }

  onLanguageChange(event: Event): void {
    this.langService.setLanguage((event.target as HTMLSelectElement).value as Language);
  }

  openChangePassword(): void {
    this.closeDropdown();
    this.modalService.openChangePassword();
  }

  logout(): void {
    this.closeDropdown();
    this.authService.logout();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.closeDropdown();
      this.closeNotifications();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDropdown();
    this.closeNotifications();
  }
}
