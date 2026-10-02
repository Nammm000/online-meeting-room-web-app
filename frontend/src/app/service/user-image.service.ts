import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, effect, inject } from '@angular/core';
import { Observable, take } from 'rxjs';
import { environment } from '../../environments/environment';
import { MessageResponse } from 'model/common.model';
import { UserImage } from 'model/user-image.model';
import { AuthService } from 'service/auth.service';

/**
 * Owns the signed-in user's avatar on /images/avatar (MinIO-backed, JWT
 * protected, current-user scoped). GET needs the Authorization header, so the
 * bytes can never be a plain <img src> — they are fetched as a Blob and
 * published through AuthService.setAvatarUrl() as a blob: object URL. The
 * header + settings page render whatever avatarUrl() holds, so both refresh
 * automatically on upload/delete.
 *
 * Session hydration (NotificationService pattern): a browser-guarded effect()
 * on sessionActive refetches the avatar on every false→true transition — app
 * start, login/signup and re-login as a different user all end in a GET. The
 * avatar is cosmetic, so every background failure is silent: 404 means the
 * server says none exists (clear — also retires legacy seeded https: URLs),
 * anything else is a transient blip and leaves the current URL alone. Never
 * cleared on session end: re-hydration on the next session start replaces it.
 */
@Injectable({ providedIn: 'root' })
export class UserImageService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = `${environment.apiUrl}/images`;

  /** The object URL this service created last; revoked when replaced. */
  private managedAvatarUrl: string | null = null;

  constructor() {
    // Owns the avatar lifecycle: a session appearing triggers one hydration
    // GET (the effect re-runs when login/signup/refresh installs a session).
    effect(() => {
      const active = this.authService.sessionActive();
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }
      if (active) {
        this.hydrateAvatar();
      }
    });

    this.destroyRef.onDestroy(() => this.revokeManagedAvatarUrl());
  }

  /** Uploads/replaces the avatar (multipart field `file`). Never set a Content-Type header — HttpClient derives it plus the boundary. */
  uploadAvatar(file: File): Observable<UserImage> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<UserImage>(`${this.baseUrl}/avatar`, body);
  }

  /** Fetches the avatar bytes; 404 when none is uploaded. */
  getAvatar(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/avatar`, { responseType: 'blob' });
  }

  /** Deletes the avatar; 404 when none is uploaded. */
  deleteAvatar(): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.baseUrl}/avatar`);
  }

  /** Re-fetches and applies the avatar after an upload (POST returns metadata only). Silent on failure. */
  refreshAvatar(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.getAvatar()
      .pipe(take(1))
      .subscribe({
        next: (blob) => this.applyAvatarBlob(blob),
        error: () => undefined, // cosmetic feature — never surface hydration noise
      });
  }

  /** Drops the local avatar after a successful delete: revoke the object URL, clear the signal. */
  clearAvatar(): void {
    this.revokeManagedAvatarUrl();
    this.authService.setAvatarUrl(null);
  }

  private hydrateAvatar(): void {
    this.getAvatar()
      .pipe(take(1))
      .subscribe({
        next: (blob) => this.applyAvatarBlob(blob),
        error: (error) => {
          // 404 is the server's definitive "no avatar": clear (this also
          // retires a legacy manually-seeded https: URL). Any other failure is
          // transient — keep whatever is displaying rather than flash initials.
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.clearAvatar();
          }
        },
      });
  }

  private applyAvatarBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const previous = this.managedAvatarUrl;
    this.managedAvatarUrl = url;
    this.authService.setAvatarUrl(url); // publish before revoking the old URL — the <img> must never point at a revoked URL
    if (previous !== null && previous !== url) {
      URL.revokeObjectURL(previous);
    }
  }

  private revokeManagedAvatarUrl(): void {
    if (this.managedAvatarUrl !== null) {
      URL.revokeObjectURL(this.managedAvatarUrl);
      this.managedAvatarUrl = null;
    }
  }
}
