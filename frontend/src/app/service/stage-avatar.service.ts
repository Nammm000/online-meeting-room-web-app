import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, take } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Per-participant avatar cache for the stage tiles. Avatars come from
 * `GET /images/avatar/{userId}` as blobs (JWT header — never a plain <img
 * src>) and live as object URLs for the session; initials remain the
 * fallback whenever a user has no avatar (404 → negative cache).
 *
 * The queue is strictly sequential with a gap: the roster poll re-invokes
 * ensureLoaded every 2.5 s and the API caps at ~3 req/s per user, so a burst
 * fetch would trip 429s. Non-404 failures cool down for 30 s before the next
 * poll may retry them.
 */
@Injectable({ providedIn: 'root' })
export class StageAvatarService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  readonly urls = signal<ReadonlyMap<number, string>>(new Map());

  private readonly objectUrls = new Map<number, string>();
  private readonly missing = new Set<number>();
  private readonly cooldownUntil = new Map<number, number>();
  private queue: number[] = [];
  private draining = false;

  private static readonly REQUEST_GAP_MS = 400;
  private static readonly RETRY_COOLDOWN_MS = 30_000;

  urlFor(userId: number): string | null {
    return this.urls().get(userId) ?? null;
  }

  /** Enqueues any roster ids not yet cached/known-missing; idempotent. */
  ensureLoaded(userIds: Iterable<number>): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const now = Date.now();
    for (const userId of userIds) {
      const cooling = (this.cooldownUntil.get(userId) ?? 0) > now;
      if (
        !this.objectUrls.has(userId) &&
        !this.missing.has(userId) &&
        !cooling &&
        !this.queue.includes(userId)
      ) {
        this.queue.push(userId);
      }
    }
    void this.drain();
  }

  /** Room teardown: revoke every object URL and forget all state. */
  clearAll(): void {
    this.queue = [];
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    this.missing.clear();
    this.cooldownUntil.clear();
    this.urls.set(new Map());
  }

  private drain(): Promise<void> {
    if (this.draining) {
      return Promise.resolve();
    }
    this.draining = true;
    return (async () => {
      try {
        while (this.queue.length > 0) {
          const userId = this.queue.shift();
          if (userId === undefined) {
            break;
          }
          await this.fetchOne(userId);
          await StageAvatarService.gap();
        }
      } finally {
        this.draining = false;
      }
    })();
  }

  private fetchOne(userId: number): Promise<void> {
    return new Promise((resolve) => {
      this.fetchAvatar(userId)
        .pipe(take(1))
        .subscribe({
          next: (blob) => {
            this.objectUrls.set(userId, URL.createObjectURL(blob));
            this.publish();
            resolve();
          },
          error: (error: { status?: number }) => {
            if (error?.status === 404) {
              this.missing.add(userId); // initials fallback — never retry this session
            } else {
              this.cooldownUntil.set(userId, Date.now() + StageAvatarService.RETRY_COOLDOWN_MS);
            }
            resolve();
          },
        });
    });
  }

  private fetchAvatar(userId: number): Observable<Blob> {
    return this.http.get(`${environment.apiUrl}/images/avatar/${userId}`, {
      responseType: 'blob',
    });
  }

  private publish(): void {
    this.urls.set(new Map(this.objectUrls));
  }

  private static gap(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, StageAvatarService.REQUEST_GAP_MS));
  }
}
