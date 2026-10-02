import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Notification } from 'model/notification.model';
import { AuthService } from 'service/auth.service';

/** Shape persisted to localStorage so the bell survives page reloads / tab discards (e.g. laptop sleep). */
interface StoredNotifications {
  notifications: Notification[];
  unreadCount: number;
}

/**
 * Receives the backend's periodic WebSocket broadcasts on /ws/notifications and
 * exposes them as signals for the header bell. Browser-only by design: on the
 * server (SSR) the service is an inert signal holder — every socket and
 * localStorage touch is guarded with isPlatformBrowser.
 *
 * Auth: the browser WebSocket API cannot set headers, so the handshake carries
 * the in-memory access token as a ?token= query param (validated server-side by
 * the handshake interceptor). Handshake auth is one-time — an open connection
 * outlives the 15-min token; expiry only matters at reconnect time.
 *
 * Sleep/wake resilience: the list + unread count persist to localStorage
 * (Chrome discards background tabs during sleep and reloads them on wake — the
 * session is silently restored, but memory-only state would be gone), network
 * errors during a reconnect refresh retry with backoff instead of killing the
 * session, and visibilitychange/online listeners reconnect immediately after a
 * wake instead of waiting out the backoff timer or a dead socket's TCP timeout.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** Newest-first history cap; also clamps the unread badge. */
  private static readonly MAX_HISTORY = 20;
  private static readonly MAX_BACKOFF_MS = 30_000;
  /** A socket still OPEN after being hidden this long is assumed dead (sleep zombie) and recycled. */
  private static readonly RECYCLE_AFTER_HIDDEN_MS = 60_000;
  private static readonly STORAGE_KEY = 'asset-manager.notifications';

  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _notifications = signal<Notification[]>([]);
  /** Newest first. */
  readonly notifications = this._notifications.asReadonly();

  private readonly _unreadCount = signal(0);
  readonly unreadCount = this._unreadCount.asReadonly();

  private readonly _connected = signal(false);
  readonly connected = this._connected.asReadonly();

  /** Derived from apiUrl (http→ws) so the API host is configured in one place. */
  private readonly wsUrl = `${environment.apiUrl.replace(/^http/, 'ws')}/ws/notifications`;

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** When the page was last hidden; drives the recycle-after-long-hide check on wake. */
  private hiddenAt: number | null = null;

  constructor() {
    this.restoreFromStorage();

    // Owns the connection lifecycle: a session appearing opens the socket (the
    // effect re-runs when login/signup/refresh installs a token), a session
    // ending closes it and resets the bell for the next session.
    effect(() => {
      const active = this.authService.sessionActive();
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }
      if (active) {
        this.connect();
      } else {
        this.disconnect(true);
      }
    });

    // Wake watchers: after laptop sleep the socket is usually dead, the network
    // may lag the page, and any pending backoff timer is stale. Removed via
    // DestroyRef (also keeps TestBed's per-test injectors from cross-talking).
    if (isPlatformBrowser(this.platformId)) {
      const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
          this.hiddenAt = Date.now();
        } else {
          this.onWake();
        }
      };
      const onOnline = (): void => this.onWake();
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('online', onOnline);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('online', onOnline);
      });
    }
  }

  /** Opening the dropdown clears the badge; the list itself is kept. */
  markAllRead(): void {
    this._unreadCount.set(0);
    this.persist();
  }

  /** "Clear all" — empties the list and the badge. */
  clearAll(): void {
    this._notifications.set([]);
    this._unreadCount.set(0);
    this.clearStorage();
  }

  /** Idempotent: one socket at a time; no-op until a token is available. */
  private connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket !== null) {
      return;
    }
    const token = this.authService.token();
    if (token === null) {
      return;
    }

    const socket = new WebSocket(`${this.wsUrl}?token=${encodeURIComponent(token)}`);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return; // a newer socket (or a disconnect) replaced this one
      }
      this._connected.set(true);
      this.reconnectAttempt = 0;
    };

    socket.onmessage = (event: MessageEvent) => this.handleMessage(event.data);

    socket.onclose = () => {
      if (this.socket !== socket) {
        return; // deliberate disconnect already cleaned up
      }
      this._connected.set(false);
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private disconnect(reset: boolean): void {
    this.cancelReconnectTimer();
    this.reconnectAttempt = 0;
    if (this.socket !== null) {
      const socket = this.socket;
      // Detach first so the socket's onclose sees it is no longer current and
      // skips the reconnect scheduling.
      this.socket = null;
      socket.close();
    }
    this._connected.set(false);
    if (reset) {
      // A fresh session starts with a fresh bell.
      this._notifications.set([]);
      this._unreadCount.set(0);
      this.clearStorage();
    }
  }

  /**
   * Exponential backoff (capped) while the tab still believes a session exists;
   * logout/expiry (sessionActive false) leaves the socket closed for good.
   */
  private scheduleReconnect(): void {
    if (!isPlatformBrowser(this.platformId) || !this.authService.sessionActive()) {
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, NotificationService.MAX_BACKOFF_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      void this.reconnect();
    }, delay);
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * The 15-min access token may have expired while the socket was down — refresh
   * first so the handshake query param carries a live token. A refresh rejection
   * with a real HTTP status (401) means the session is dead: hand off to
   * sessionExpired() (the HTTP interceptor's automatic handling does not apply
   * to service-initiated calls). A status-0 network error (e.g. the network
   * stack not being back yet after a wake) is transient: retry via backoff
   * instead of logging the user out and wiping the bell.
   */
  private async reconnect(): Promise<void> {
    if (!this.authService.sessionActive()) {
      return;
    }
    if (!this.authService.hasLiveAccessToken()) {
      try {
        await firstValueFrom(this.authService.refreshSession());
      } catch (error) {
        if (this.isNetworkError(error)) {
          this.scheduleReconnect();
        } else {
          this.authService.sessionExpired();
        }
        return;
      }
    }
    this.connect();
  }

  /**
   * The page became visible again or the network came back. Don't sit out a
   * pending backoff timer, and recycle a socket that sat OPEN through a long
   * hide — after a laptop sleep it is almost certainly a zombie whose onclose
   * the browser hasn't noticed. Short hides (alt-tab) leave a healthy socket.
   */
  private onWake(): void {
    if (!this.authService.sessionActive()) {
      return;
    }
    const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    this.hiddenAt = null;

    const socket = this.socket;
    if (socket !== null) {
      if (socket.readyState === WebSocket.OPEN) {
        if (hiddenFor < NotificationService.RECYCLE_AFTER_HIDDEN_MS) {
          return; // healthy connection, nothing to do
        }
      } else if (socket.readyState === WebSocket.CONNECTING) {
        return; // handshake in flight — let it settle
      }
      // OPEN-after-long-hide (zombie) or CLOSING/CLOSED: recycle and go again.
      this.socket = null; // detach first so onclose skips its scheduling
      socket.close();
    }
    this.cancelReconnectTimer();
    this.reconnectAttempt = 0;
    void this.reconnect();
  }

  private handleMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : '');
    } catch {
      return; // malformed frame — ignore rather than break the bell
    }
    if (!this.isNotification(parsed)) {
      return;
    }
    this._notifications.update((list) => [parsed, ...list].slice(0, NotificationService.MAX_HISTORY));
    this._unreadCount.update((count) => Math.min(count + 1, NotificationService.MAX_HISTORY));
    this.persist();
  }

  /** Shape + parseable-timestamp guard for anything arriving off the socket or out of storage. */
  private isNotification(value: unknown): value is Notification {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate['message'] === 'string' &&
      typeof candidate['timestamp'] === 'string' &&
      !Number.isNaN(Date.parse(candidate['timestamp']))
    );
  }

  /** HttpErrorResponse with status 0 — the browser couldn't reach the server at all. */
  private isNetworkError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as Record<string, unknown>)['status'] === 0;
  }

  private restoreFromStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(NotificationService.STORAGE_KEY);
    } catch {
      return; // storage unavailable (private mode etc.) — start empty
    }
    if (raw === null) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        return;
      }
      const candidate = parsed as Record<string, unknown>;
      const list = Array.isArray(candidate['notifications'])
        ? candidate['notifications'].filter((item) => this.isNotification(item)).slice(0, NotificationService.MAX_HISTORY)
        : [];
      const unreadRaw = candidate['unreadCount'];
      const unreadCount =
        typeof unreadRaw === 'number' && Number.isFinite(unreadRaw)
          ? Math.min(Math.max(Math.trunc(unreadRaw), 0), NotificationService.MAX_HISTORY)
          : 0;
      this._notifications.set(list);
      this._unreadCount.set(unreadCount);
    } catch {
      // corrupt storage — start with an empty bell rather than crash
    }
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const snapshot: StoredNotifications = {
      notifications: this._notifications(),
      unreadCount: this._unreadCount(),
    };
    try {
      localStorage.setItem(NotificationService.STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // storage full/unavailable — in-memory state stays authoritative
    }
  }

  private clearStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      localStorage.removeItem(NotificationService.STORAGE_KEY);
    } catch {
      // nothing to do — storage already unavailable
    }
  }
}
