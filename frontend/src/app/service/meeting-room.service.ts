import { isPlatformBrowser } from '@angular/common';
import {
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Observable, take } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from 'service/auth.service';
import { MeetingService } from 'service/meeting.service';
import { MeetingParticipantService } from 'service/meeting-participant.service';
import { MeetingChatService } from 'service/meeting-chat.service';
import { getApiErrorMessage } from 'util/api-util';
import { GlobalMessages } from 'component/shared/global-constants';
import type {
  ChatMessage,
  Meeting,
  MeetingRoleUpdate,
  MyMeetingStatus,
  Participant,
} from 'model/meeting.model';

/**
 * What the room template renders. Derived purely from the last /me data:
 * notFound (404), terminal meeting states (ended/cancelled — chat stays
 * readable), removed/denied (kicked out), waiting (lobby), preJoin (never
 * joined, or left/declined — rejoin goes straight back in), joined.
 */
export type MeetingViewState =
  | 'idle'
  | 'loading'
  | 'notFound'
  | 'preJoin'
  | 'waiting'
  | 'joined'
  | 'removed'
  | 'ended'
  | 'cancelled';

/**
 * Signal store for one meeting room. The backend has no per-user push channel
 * yet — presence is REST polling by design (server docs list it as a known
 * gap) — so this service owns two loops and keeps them inside the backend's
 * 3 req/s per-user budget:
 *
 * - /me every 2 s (the authority: participant status, media credentials —
 *   re-minted each poll, never cached — and meeting state).
 * - a 5 s secondary cycle that runs only while joined: roster → lobby (for
 *   moderators) → chat page-0 reconcile, strictly sequential so at most one
 *   request is in flight per tick.
 *
 * Steady state ≈ 1.1 req/s. Transient failures (status 0, 429) back the /me
 * loop off exponentially to 10 s; 404/401 and terminal states (meeting
 * ended/cancelled, participant removed/denied) stop the loops outright —
 * nothing changes server-side until the user acts, and join() restarts them.
 *
 * Browser-only, NotificationService-style: on the server (and in an unmounted
 * state) the service is an inert signal holder.
 */
@Injectable({ providedIn: 'root' })
export class MeetingRoomService {
  private static readonly ME_POLL_MS = 2000;
  private static readonly SECONDARY_POLL_MS = 5000;
  private static readonly MAX_BACKOFF_MS = 10_000;
  private static readonly CHAT_PAGE_SIZE = 30;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly meetingService = inject(MeetingService);
  private readonly participantService = inject(MeetingParticipantService);
  private readonly chatService = inject(MeetingChatService);

  // ── state ──────────────────────────────────────────────────────────────
  private readonly _status = signal<MyMeetingStatus | null>(null);
  readonly status = this._status.asReadonly();

  private readonly _roster = signal<Participant[]>([]);
  readonly roster = this._roster.asReadonly();

  private readonly _lobby = signal<Participant[]>([]);
  readonly lobby = this._lobby.asReadonly();

  /** Ascending display order (the backend page sort is DESC — pages get reversed). */
  private readonly _chatMessages = signal<ChatMessage[]>([]);
  readonly chatMessages = this._chatMessages.asReadonly();

  private readonly _chatHasMore = signal(false);
  readonly chatHasMore = this._chatHasMore.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _active = signal(false);
  readonly active = this._active.asReadonly();

  private readonly _notFound = signal(false);

  /** Row-level busy flag (admit/deny/mute/remove/role) — one action at a time. */
  private readonly _actingUserId = signal<number | null>(null);
  readonly actingUserId = this._actingUserId.asReadonly();

  readonly joining = signal(false);
  readonly leaving = signal(false);
  readonly ending = signal(false);
  readonly chatSending = signal(false);
  readonly chatLoadingOlder = signal(false);

  /** Last action failure (muting, admitting, sending…) for inline display. */
  private readonly _actionError = signal('');
  readonly actionError = this._actionError.asReadonly();

  private joinCode: string | null = null;
  private meTimer: ReturnType<typeof setTimeout> | null = null;
  private secondaryTimer: ReturnType<typeof setTimeout> | null = null;
  private meBackoffAttempt = 0;
  /** Index of the oldest chat page held locally (page 0 = newest window). */
  private chatOldestPage = 0;
  private chatLoaded = false;

  // ── derived ────────────────────────────────────────────────────────────
  readonly meeting = computed<Meeting | null>(() => this._status()?.meeting ?? null);
  readonly me = computed<Participant | null>(() => this._status()?.participant ?? null);
  readonly media = computed(() => this._status()?.media ?? null);
  readonly myUserId = computed(() => this.me()?.userId ?? null);
  readonly isHost = computed(() => this.me()?.role === 'HOST');
  readonly isCohost = computed(() => this.me()?.role === 'COHOST');
  readonly canModerate = computed(() => this.isHost() || this.isCohost());
  readonly inProgress = computed(() => this.meeting()?.status === 'IN_PROGRESS');
  readonly canSendChat = computed(() => this.viewState() === 'joined');

  readonly viewState = computed<MeetingViewState>(() => {
    if (this._notFound()) {
      return 'notFound';
    }
    const status = this._status();
    if (status === null) {
      return this._loading() ? 'loading' : 'idle';
    }
    if (status.meeting.status === 'ENDED') {
      return 'ended';
    }
    if (status.meeting.status === 'CANCELLED') {
      return 'cancelled';
    }
    const participant = status.participant;
    if (participant === null || participant.status === 'LEFT' || participant.status === 'DECLINED') {
      return 'preJoin';
    }
    if (participant.status === 'WAITING') {
      return 'waiting';
    }
    if (participant.status === 'REMOVED' || participant.status === 'DENIED') {
      return 'removed';
    }
    return 'joined';
  });

  constructor() {
    // Logout-while-in-room (header dropdown, expiry elsewhere): stop polling
    // instead of hammering dead endpoints (NotificationService pattern).
    effect(() => {
      if (!this.authService.sessionActive() && this._active()) {
        this.stop();
      }
    });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Idempotent room entry: seeds state and arms the loops (browser only). */
  start(joinCode: string): void {
    if (this._active() && this.joinCode === joinCode) {
      return;
    }
    this.clearTimers();
    this.joinCode = joinCode;
    this.meBackoffAttempt = 0;
    this.chatOldestPage = 0;
    this.chatLoaded = false;
    this._notFound.set(false);
    this._status.set(null);
    this._roster.set([]);
    this._lobby.set([]);
    this._chatMessages.set([]);
    this._chatHasMore.set(false);
    this._actionError.set('');
    this._actingUserId.set(null);
    this._loading.set(true);
    this._active.set(true);
    if (isPlatformBrowser(this.platformId)) {
      this.pollMe();
    }
  }

  /** Room unmounted: clears timers and in-flight guards. Data stays for the view. */
  stop(): void {
    this.clearTimers();
    this.joinCode = null;
    this._active.set(false);
    this._actingUserId.set(null);
  }

  /** Manual refresh — immediate /me plus, when joined, a secondary cycle. */
  refreshNow(): void {
    if (!this._active() || this.joinCode === null || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.pollMe();
    if (this.viewState() === 'joined') {
      this.runSecondaryCycle();
    }
  }

  // ── participation actions ──────────────────────────────────────────────

  join(): void {
    const code = this.joinCode;
    if (code === null || this.joining()) {
      return;
    }
    this.joining.set(true);
    this._actionError.set('');
    this.participantService
      .join(code)
      .pipe(take(1))
      .subscribe({
        next: (status) => {
          this.joining.set(false);
          const halted = this.applyStatus(status);
          if (!halted) {
            this.restartLoops();
          }
        },
        error: (error) => {
          this.joining.set(false);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  leave(onDone: () => void): void {
    const code = this.joinCode;
    if (code === null || this.leaving()) {
      return;
    }
    this.leaving.set(true);
    this.participantService
      .leave(code)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.stop();
          onDone();
        },
        error: (error) => {
          this.leaving.set(false);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  setSelfMuted(muted: boolean): void {
    const code = this.joinCode;
    if (code === null || this._actingUserId() !== null) {
      return;
    }
    this._actingUserId.set(this.myUserId());
    this._actionError.set('');
    this.participantService
      .setSelfMute(code, muted)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this._actingUserId.set(null);
          // Flip locally for a snappy tile; the next /me poll confirms.
          this._status.update((status) =>
            status && status.participant
              ? { ...status, participant: { ...status.participant, muted } }
              : status,
          );
        },
        error: (error) => {
          this._actingUserId.set(null);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  muteParticipant(userId: number, muted: boolean): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this.runRowAction(userId, this.participantService.muteParticipant(code, userId, muted));
  }

  removeParticipant(userId: number): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this.runRowAction(userId, this.participantService.removeParticipant(code, userId));
  }

  admitUser(userId: number): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this.runRowAction(userId, this.participantService.admit(code, userId));
  }

  denyUser(userId: number): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this.runRowAction(userId, this.participantService.deny(code, userId));
  }

  setRole(userId: number, role: MeetingRoleUpdate): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this.runRowAction(userId, this.participantService.setRole(code, userId, role));
  }

  setLocked(locked: boolean): void {
    const code = this.joinCode;
    if (code === null || this._actingUserId() !== null) {
      return;
    }
    this._actingUserId.set(0); // meeting-level busy, no specific row
    this._actionError.set('');
    this.participantService
      .setLocked(code, locked)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this._actingUserId.set(null);
          this._status.update((status) =>
            status ? { ...status, meeting: { ...status.meeting, locked } } : status,
          );
        },
        error: (error) => {
          this._actingUserId.set(null);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  endMeeting(): void {
    const meeting = this.meeting();
    if (meeting === null || this.ending()) {
      return;
    }
    this.ending.set(true);
    this._actionError.set('');
    this.meetingService
      .end(meeting.id)
      .pipe(take(1))
      .subscribe({
        next: (ended) => {
          this.ending.set(false);
          this._status.update((status) => (status ? { ...status, meeting: ended } : status));
          this.clearTimers(); // terminal state — chat data stays readable
        },
        error: (error) => {
          this.ending.set(false);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  // ── chat actions ───────────────────────────────────────────────────────

  sendChat(content: string): void {
    const code = this.joinCode;
    const trimmed = content.trim();
    if (code === null || !this.canSendChat() || this.chatSending()) {
      return;
    }
    if (trimmed === '' || trimmed.length > 2000) {
      return;
    }
    this.chatSending.set(true);
    this._actionError.set('');
    this.chatService
      .send(code, trimmed)
      .pipe(take(1))
      .subscribe({
        next: (message) => {
          this.chatSending.set(false);
          // The 5 s reconcile may already have picked it up — dedupe by id.
          this._chatMessages.update((list) =>
            list.some((existing) => existing.id === message.id) ? list : [...list, message],
          );
        },
        error: (error) => {
          this.chatSending.set(false);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  /** Local removal is immediate; the server delete is idempotent. */
  deleteChatMessage(messageId: number): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this._chatMessages.update((list) => list.filter((message) => message.id !== messageId));
    this._actionError.set('');
    this.chatService
      .delete(code, messageId)
      .pipe(take(1))
      .subscribe({
        error: (error) =>
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError)),
      });
  }

  loadOlderChat(): void {
    const code = this.joinCode;
    if (code === null || !this.chatHasMore() || this.chatLoadingOlder()) {
      return;
    }
    const nextPage = this.chatOldestPage + 1;
    this.chatLoadingOlder.set(true);
    this.chatService
      .getMessages(code, nextPage, MeetingRoomService.CHAT_PAGE_SIZE)
      .pipe(take(1))
      .subscribe({
        next: (page) => {
          this.chatLoadingOlder.set(false);
          const fetched = page.content.slice().reverse();
          // Page indexes shift as new messages arrive — skip anything the
          // newest window already holds.
          const oldestHeldId = this.oldestHeldChatId();
          const older = fetched.filter((message) => message.id < oldestHeldId);
          this._chatMessages.update((list) => [...older, ...list]);
          this.chatOldestPage = nextPage;
          this._chatHasMore.set(!page.last);
        },
        error: () => {
          this.chatLoadingOlder.set(false);
        },
      });
  }

  // ── polling internals ──────────────────────────────────────────────────

  private pollMe(): void {
    const code = this.joinCode;
    if (code === null || !this._active()) {
      return;
    }
    this.participantService
      .me(code)
      .pipe(take(1))
      .subscribe({
        next: (status) => {
          if (!this._active() || this.joinCode !== code) {
            return; // stopped (or restarted elsewhere) while in flight
          }
          this.meBackoffAttempt = 0;
          const halted = this.applyStatus(status);
          if (!halted) {
            this.scheduleMe(MeetingRoomService.ME_POLL_MS);
          }
        },
        error: (error) => this.onMeError(code, error),
      });
  }

  private onMeError(code: string, error: unknown): void {
    if (!this._active() || this.joinCode !== code) {
      return;
    }
    const status = (error as { status?: number }).status;
    if (status === 404) {
      this.clearTimers();
      this._loading.set(false);
      this._notFound.set(true);
      return;
    }
    if (status === 401) {
      // The interceptor already refreshed once — the session is dead.
      this.clearTimers();
      this._loading.set(false);
      this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
      return;
    }
    // Transient (status 0 / 429 rate limit): back off, retry.
    const delay = Math.min(
      MeetingRoomService.ME_POLL_MS * 2 ** this.meBackoffAttempt,
      MeetingRoomService.MAX_BACKOFF_MS,
    );
    this.meBackoffAttempt++;
    this.scheduleMe(delay);
  }

  private scheduleMe(delay: number): void {
    if (!this._active() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.clearMeTimer();
    this.meTimer = setTimeout(() => this.pollMe(), delay);
  }

  /** Roster → lobby (moderators) → chat reconcile, strictly sequential. */
  private runSecondaryCycle(): void {
    const code = this.joinCode;
    if (code === null || !this._active() || this.viewState() !== 'joined') {
      return;
    }
    this.participantService
      .getRoster(code)
      .pipe(take(1))
      .subscribe({
        next: (roster) => {
          this._roster.set(roster);
          this.afterRoster(code);
        },
        error: () => this.afterRoster(code), // secondary data is best-effort
      });
  }

  private afterRoster(code: string): void {
    if (!this._active() || this.joinCode !== code) {
      return;
    }
    if (!this.canModerate()) {
      this.reconcileChat();
      return;
    }
    this.participantService
      .getLobby(code)
      .pipe(take(1))
      .subscribe({
        next: (lobby) => {
          this._lobby.set(lobby);
          this.reconcileChat();
        },
        error: () => this.reconcileChat(),
      });
  }

  /**
   * Replaces the newest-message window with page 0 and keeps anything older:
   * picks up sends from other tabs and deletions inside the window. Deletes
   * older than the window persist until a reload (documented trade-off).
   */
  private reconcileChat(): void {
    const code = this.joinCode;
    if (code === null || !this._active()) {
      return;
    }
    this.chatService
      .getMessages(code, 0, MeetingRoomService.CHAT_PAGE_SIZE)
      .pipe(take(1))
      .subscribe({
        next: (page) => {
          if (!this._active() || this.joinCode !== code) {
            return;
          }
          const fetched = page.content.slice().reverse();
          if (fetched.length === 0) {
            // Everything in the newest window was deleted — only clear the
            // board when nothing older exists either.
            if (page.totalElements === 0) {
              this._chatMessages.set([]);
            }
          } else {
            const newestFetchedId = fetched[fetched.length - 1].id;
            const oldestFetchedId = fetched[0].id;
            const older = this._chatMessages().filter(
              (message) =>
                message.id < oldestFetchedId || message.id > newestFetchedId,
            );
            this._chatMessages.set([...older, ...fetched]);
          }
          this.chatOldestPage = 0;
          this._chatHasMore.set(!page.last);
        },
        error: () => {
          // best-effort — /me is the authority
        },
      });
  }

  private scheduleSecondary(delay: number): void {
    if (!this._active() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.clearSecondaryTimer();
    this.secondaryTimer = setTimeout(() => {
      this.runSecondaryCycle();
      this.scheduleSecondary(MeetingRoomService.SECONDARY_POLL_MS);
    }, delay);
  }

  /** Re-arm after join(): the join response already seeded the status. */
  private restartLoops(): void {
    if (!this._active() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.clearTimers();
    this.scheduleMe(MeetingRoomService.ME_POLL_MS);
  }

  /**
   * Installs a fresh /me snapshot. Returns true when the loops must halt
   * (terminal meeting/participant state — nothing changes server-side until
   * the user acts, and join() restarts them).
   */
  private applyStatus(status: MyMeetingStatus): boolean {
    this._loading.set(false);
    this._status.set(status);

    const meetingStatus = status.meeting.status;
    const participantStatus = status.participant?.status;
    const terminal =
      meetingStatus === 'ENDED' ||
      meetingStatus === 'CANCELLED' ||
      participantStatus === 'REMOVED' ||
      participantStatus === 'DENIED';
    if (terminal) {
      this.clearTimers();
      return true;
    }

    if (!this.secondaryArmed && this.viewState() === 'joined') {
      this.secondaryArmed = true;
      this.scheduleSecondary(MeetingRoomService.SECONDARY_POLL_MS);
    }
    this.ensureChatLoaded();
    return false;
  }

  /** One-shot initial history load — readable by any past-or-present participant. */
  private ensureChatLoaded(): void {
    const code = this.joinCode;
    if (code === null || this.chatLoaded || !this._active()) {
      return;
    }
    const state = this.viewState();
    if (state !== 'joined' && state !== 'ended' && state !== 'cancelled') {
      return;
    }
    this.chatLoaded = true;
    this.chatService
      .getMessages(code, 0, MeetingRoomService.CHAT_PAGE_SIZE)
      .pipe(take(1))
      .subscribe({
        next: (page) => {
          this._chatMessages.set(page.content.slice().reverse());
          this.chatOldestPage = 0;
          this._chatHasMore.set(!page.last);
        },
        error: () => {
          this.chatLoaded = false; // retry on the next /me success
        },
      });
  }

  // ── small helpers ──────────────────────────────────────────────────────

  private secondaryArmed = false;

  /** Row actions all share one busy flag and refresh the secondary data on success. */
  private runRowAction(userId: number, request$: Observable<unknown>): void {
    if (this._actingUserId() !== null) {
      return;
    }
    this._actingUserId.set(userId);
    this._actionError.set('');
    request$.pipe(take(1)).subscribe({
      next: () => {
        this._actingUserId.set(null);
        if (this._active() && this.viewState() === 'joined') {
          this.runSecondaryCycle();
        }
      },
      error: (error) => {
        this._actingUserId.set(null);
        this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
      },
    });
  }

  private oldestHeldChatId(): number {
    const messages = this._chatMessages();
    return messages.length === 0 ? Number.POSITIVE_INFINITY : messages[0].id;
  }

  private clearMeTimer(): void {
    if (this.meTimer !== null) {
      clearTimeout(this.meTimer);
      this.meTimer = null;
    }
  }

  private clearSecondaryTimer(): void {
    if (this.secondaryTimer !== null) {
      clearTimeout(this.secondaryTimer);
      this.secondaryTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearMeTimer();
    this.clearSecondaryTimer();
    this.secondaryArmed = false;
  }
}
