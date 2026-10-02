import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { take } from 'rxjs';
import { UserService } from 'service/user.service';
import { AuthService } from 'service/auth.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import { UserImageService } from 'service/user-image.service';
import type { UserWrapper } from 'model/user.model';
import { getApiErrorMessage } from 'util/api-util';
import { customFormattedDate } from 'util/time-util';
import { GlobalMessages } from 'component/shared/global-constants';

/** Mirrors the backend's avatar validation (UserImageService.MAX_SIZE_BYTES + allowed types). */
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Account page for the signed-in user (name, contact, role, account
 * level/number) with avatar management: upload/replace via the edit overlay on
 * the avatar, remove via the shared confirmation modal. The avatar itself is
 * fetched/published by UserImageService (see its doc comment) — this page only
 * triggers uploads/deletes and lets the avatarUrl signal re-render the
 * header + this card.
 */
@Component({
  selector: 'app-user-setting',
  imports: [],
  templateUrl: './user-setting.html',
  styleUrl: './user-setting.scss',
})
export class UserSetting implements OnInit {
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly profile = signal<UserWrapper | null>(null);
  readonly avatarLoadFailed = signal(false);

  // Avatar management: one busy flag gates upload AND remove (no double-submit).
  readonly avatarBusy = signal(false);
  readonly avatarError = signal('');
  readonly avatarSuccess = signal('');

  constructor(
    private userService: UserService,
    // protected: referenced directly from the template (strictTemplates forbids private)
    protected authService: AuthService,
    private modalService: ModalService,
    protected langService: LanguageService,
    private userImageService: UserImageService,
  ) {
    // A changed avatar URL (e.g. re-login as someone else) must retry the <img>.
    effect(() => {
      this.authService.avatarUrl();
      this.avatarLoadFailed.set(false);
    });
  }

  // Null-safe: profile() can be null while loading, and email() while logged out.
  readonly initials = computed(
    () => (this.profile()?.name ?? this.authService.email() ?? '?').charAt(0).toUpperCase(),
  );

  // Null when no URL is stored or the <img> errored -> initials fallback.
  readonly avatarSrc = computed(() =>
    this.avatarLoadFailed() ? null : this.authService.avatarUrl(),
  );

  // Server truth (avatarUrl), not avatarSrc() — a mere <img> load error must
  // not hide the Remove button.
  readonly hasAvatar = computed(() => this.authService.avatarUrl() !== null);

  // Formatting utils for the template
  protected readonly customFormattedDate = customFormattedDate;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.userService
      .getCurrentUser()
      .pipe(take(1))
      .subscribe({
        next: (user) => {
          this.profile.set(user);
          this.loading.set(false);
        },
        error: (error) => {
          this.errorMessage.set(getApiErrorMessage(error, GlobalMessages.genericError));
          this.loading.set(false);
        },
      });
  }

  openChangePassword(): void {
    this.modalService.openChangePassword();
  }

  onAvatarError(): void {
    this.avatarLoadFailed.set(true);
  }

  onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Reset before anything else so picking the same file twice re-fires change.
    input.value = '';
    if (file === null) {
      return; // picker cancelled
    }
    this.avatarSuccess.set('');
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      this.avatarError.set(this.langService.t('userSetting.avatarInvalidType'));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      this.avatarError.set(this.langService.t('userSetting.avatarTooLarge'));
      return;
    }
    this.avatarError.set('');
    this.avatarBusy.set(true);
    this.userImageService
      .uploadAvatar(file)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.avatarBusy.set(false);
          this.avatarSuccess.set(this.langService.t('userSetting.avatarUpdated'));
          // POST returns metadata only — re-fetch the bytes to refresh the header + card.
          this.userImageService.refreshAvatar();
        },
        error: (error) => {
          this.avatarBusy.set(false);
          this.avatarError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  confirmRemoveAvatar(): void {
    this.modalService.openConfirmation({
      title: this.langService.t('userSetting.removeAvatar'),
      message: this.langService.t('userSetting.avatarRemoveMessage'),
      confirmLabel: this.langService.t('userSetting.removeAvatar'),
      danger: true,
      onConfirm: () => this.removeAvatar(),
    });
  }

  private removeAvatar(): void {
    this.avatarSuccess.set('');
    this.avatarBusy.set(true);
    this.userImageService
      .deleteAvatar()
      .pipe(take(1))
      .subscribe({
        next: () => this.onAvatarRemoved(),
        error: (error) => {
          // 404 = already gone (deleted in another tab): clearing is the
          // correct end state. Anything else keeps the avatar.
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.onAvatarRemoved();
            return;
          }
          this.avatarBusy.set(false);
          this.avatarError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  private onAvatarRemoved(): void {
    this.avatarBusy.set(false);
    this.avatarError.set('');
    this.avatarSuccess.set(this.langService.t('userSetting.avatarRemoved'));
    this.userImageService.clearAvatar();
  }
}
