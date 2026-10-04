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
import { ModalService } from 'service/modal.service';
import { SpeechDetectionService } from 'service/speech-detection.service';
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
 * gap) — so this service owns three loops and keeps them inside the backend's
 * 3 req/s per-user budget:
 *
 * - /me every 2 s (the authority: participant status, media credentials —
 *   re-minted each poll, never cached — and meeting state).
 * - a roster loop every 2.5 s while joined — the speaking flag rides it, so
 *   the cadence is what bounds indicator lag (~3 s end to end).
 * - a 5 s secondary cycle that runs only while joined: lobby (for moderators)
 *   → chat page-0 reconcile, strictly sequential so at most one request of
 *   this chain is in flight per tick.
 *
 * Steady state ≈ 1.4 req/s plus throttled speaking PATCHes (≥ 1.5 s apart).
 * Transient failures (status 0, 429) back the /me loop off exponentially to
 * 10 s; 404/401 and terminal states (meeting ended/cancelled, participant
 * removed/denied) stop the loops outright — nothing changes server-side until
 * the user acts, and join() restarts them.
 *
 * Browser-only, NotificationService-style: on the server (and in an unmounted
 * state) the service is an inert signal holder.
 */
@Injectable({ providedIn: 'root' })
export class MeetingRoomService {
  private static readonly ME_POLL_MS = 2000;
  private static readonly ROSTER_POLL_MS = 2500;
  private static readonly SECONDARY_POLL_MS = 5000;
  private static readonly MAX_BACKOFF_MS = 10_000;
  private static readonly CHAT_PAGE_SIZE = 30;
  /** Minimum gap between speaking PATCHes — keeps the rate budget intact. */
  private static readonly SPEAKING_SEND_MIN_MS = 1500;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly meetingService = inject(MeetingService);
  private readonly participantService = inject(MeetingParticipantService);
  private readonly chatService = inject(MeetingChatService);
  private readonly modalService = inject(ModalService);
  private readonly speech = inject(SpeechDetectionService);

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
  private rosterTimer: ReturnType<typeof setTimeout> | null = null;
  private secondaryTimer: ReturnType<typeof setTimeout> | null = null;
  private speakingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private meBackoffAttempt = 0;
  /** Last speaking value PATCHed, and when — false matches the server's row default, so a fresh join sends nothing. */
  private lastSentSpeaking = false;
  private lastSpeakingSentAt = 0;
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

  /**
   * Stage order: self pinned first (the adjacency anchor), active speakers
   * immediately after it — most recent first — everyone else in roster order.
   */
  readonly stageParticipants = computed<Participant[]>(() => {
    const roster = this._roster();
    const myId = this.myUserId();
    if (myId === null) {
      return roster;
    }
    const self = roster.find((participant) => participant.userId === myId);
    if (self === undefined) {
      return roster;
    }
    const others = roster.filter((participant) => participant.userId !== myId);
    const speakers = others
      .filter((participant) => participant.speaking)
      .sort((a, b) => (b.lastSpeakingAt ?? '').localeCompare(a.lastSpeakingAt ?? ''));
    const rest = others.filter((participant) => !participant.speaking);
    return [self, ...speakers, ...rest];
  });

  constructor() {
    // Logout-while-in-room (header dropdown, expiry elsewhere): stop polling
    // instead of hammering dead endpoints (NotificationService pattern).
    effect(() => {
      if (!this.authService.sessionActive() && this._active()) {
        this.stop();
      }
    });

    // Mic analysis runs only while the room is active, joined and unmuted —
    // the server clamps speaking to false for muted participants, so skip the
    // permission ask. stop() keeps viewState (data stays for the view), hence
    // the explicit _active() read.
    effect(() => {
      const micLive =
        this._active() && this.viewState() === 'joined' && !(this.me()?.muted ?? true);
      if (micLive) {
        this.speech.start();
      } else {
        this.speech.stop();
      }
    });

    // Forward speaking transitions over REST, throttled to ≥ 1.5 s apart so
    // bursts stay inside the rate budget (a trailing timer keeps the latest
    // state from being dropped by the window).
    effect(() => {
      const speaking = this.speech.speaking();
      const code = this.joinCode;
      if (!this._active() || code === null || this.viewState() !== 'joined') {
        return;
      }
      if (speaking === this.lastSentSpeaking) {
        return;
      }
      const since = Date.now() - this.lastSpeakingSentAt;
      if (since >= MeetingRoomService.SPEAKING_SEND_MIN_MS) {
        this.sendSpeaking(code, speaking);
      } else if (this.speakingFlushTimer === null) {
        this.speakingFlushTimer = setTimeout(() => {
          this.speakingFlushTimer = null;
          const latest = this.speech.speaking();
          if (
            this._active() &&
            this.viewState() === 'joined' &&
            this.joinCode !== null &&
            latest !== this.lastSentSpeaking
          ) {
            this.sendSpeaking(this.joinCode, latest);
          }
        }, MeetingRoomService.SPEAKING_SEND_MIN_MS - since);
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
    this.lastSentSpeaking = false;
    this.lastSpeakingSentAt = 0;
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

  /** Manual refresh — immediate /me plus, when joined, both secondary chains. */
  refreshNow(): void {
    if (!this._active() || this.joinCode === null || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.pollMe();
    if (this.viewState() === 'joined') {
      this.fetchRoster();
      this.runSecondaryCycle();
    }
  }

  // ── participation actions ──────────────────────────────────────────────

  /**
   * Joins the meeting. A password-protected meeting (known from the /me poll's
   * `hasPassword`; the host account is exempt) prompts for the password first
   * and re-prompts on a 403 — the only 403 this endpoint can return is the
   * password gate, and 401 is reserved for session death (the interceptor).
   */
  join(password?: string): void {
    const code = this.joinCode;
    if (code === null || this.joining()) {
      return;
    }
    if (password === undefined && this.meeting()?.hasPassword && this.me()?.role !== 'HOST') {
      this.modalService.openJoinPassword({
        meetingTitle: this.meeting()?.title,
        onSubmit: (entered) => this.join(entered),
      });
      return;
    }
    this.joining.set(true);
    this._actionError.set('');
    this.participantService
      .join(code, password ?? null)
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
          if ((error as { status?: number }).status === 403) {
            this.modalService.openJoinPassword({
              meetingTitle: this.meeting()?.title,
              errorMessage: getApiErrorMessage(error, GlobalMessages.genericError),
              onSubmit: (entered) => this.join(entered),
            });
            return;
          }
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
          // Muting also kills the speaking flag (the server clamps it too).
          this._status.update((status) =>
            status && status.participant
              ? {
                  ...status,
                  participant: muted
                    ? { ...status.participant, muted, speaking: false }
                    : { ...status.participant, muted },
                }
              : status,
          );
          if (muted) {
            this._roster.update((roster) =>
              roster.map((participant) =>
                participant.userId === this.myUserId()
                  ? { ...participant, speaking: false }
                  : participant,
              ),
            );
          }
        },
        error: (error) => {
          this._actingUserId.set(null);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  /**
   * Self raised-hand toggle. Success-flips locally for a snappy toolbar/tile
   * (the next roster poll re-syncs everyone else) — no speaking-clamp logic,
   * a raised hand while muted is legitimate.
   */
  setSelfHandRaised(handRaised: boolean): void {
    const code = this.joinCode;
    if (code === null || this._actingUserId() !== null) {
      return;
    }
    this._actingUserId.set(this.myUserId());
    this._actionError.set('');
    this.participantService
      .setSelfHand(code, handRaised)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this._actingUserId.set(null);
          this._status.update((status) =>
            status && status.participant
              ? { ...status, participant: { ...status.participant, handRaised } }
              : status,
          );
          const myId = this.myUserId();
          this._roster.update((roster) =>
            roster.map((participant) =>
              participant.userId === myId ? { ...participant, handRaised } : participant,
            ),
          );
        },
        error: (error) => {
          this._actingUserId.set(null);
          this._actionError.set(getApiErrorMessage(error, GlobalMessages.genericError));
        },
      });
  }

  /**
   * Optimistic speaking update: flips self locally (own tile lights instantly)
   * then PATCHes; failures are swallowed — the next roster poll re-syncs.
   */
  private sendSpeaking(code: string, speaking: boolean): void {
    this.lastSentSpeaking = speaking;
    this.lastSpeakingSentAt = Date.now();
    this._status.update((status) =>
      status && status.participant
        ? { ...status, participant: { ...status.participant, speaking } }
        : status,
    );
    const myId = this.myUserId();
    this._roster.update((roster) =>
      roster.map((participant) =>
        participant.userId === myId ? { ...participant, speaking } : participant,
      ),
    );
    this.participantService
      .setSelfSpeaking(code, speaking)
      .pipe(take(1))
      .subscribe({
        error: () => {
          // best-effort: a dropped update re-syncs on the next roster poll
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

  /** Moderator lower-hand; the roster refresh rides runRowAction. */
  lowerHand(userId: number): void {
    const code = this.joinCode;
    if (code === null) {
      return;
    }
    this.runRowAction(userId, this.participantService.handParticipant(code, userId, false));
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

  sendChat(content: string, recipientUserId?: number | null): void {
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
      .send(code, trimmed, recipientUserId ?? null)
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

  /** Roster chain (~2.5 s): one GET per tick — the speaking flag rides it. */
  private fetchRoster(): void {
    const code = this.joinCode;
    if (code === null || !this._active() || this.viewState() !== 'joined') {
      return;
    }
    this.participantService
      .getRoster(code)
      .pipe(take(1))
      .subscribe({
        next: (roster) => {
          if (!this._active() || this.joinCode !== code) {
            return; // stopped (or restarted elsewhere) while in flight
          }
          this._roster.set(roster);
          this.scheduleRoster(MeetingRoomService.ROSTER_POLL_MS);
        },
        error: () => {
          if (!this._active() || this.joinCode !== code) {
            return;
          }
          this.scheduleRoster(MeetingRoomService.ROSTER_POLL_MS); // secondary data is best-effort
        },
      });
  }

  /** Lobby (moderators) → chat reconcile, strictly sequential (~5 s chain). */
  private runSecondaryCycle(): void {
    const code = this.joinCode;
    if (code === null || !this._active() || this.viewState() !== 'joined') {
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

  private scheduleRoster(delay: number): void {
    if (!this._active() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.clearRosterTimer();
    this.rosterTimer = setTimeout(() => this.fetchRoster(), delay);
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

    if (!this.rosterArmed && this.viewState() === 'joined') {
      this.rosterArmed = true;
      this.fetchRoster(); // immediate first roster — the stage needs it right after join
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
  private rosterArmed = false;

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
          this.fetchRoster(); // moderation actions are roster-visible; chat reconciles on its own timer
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

  private clearRosterTimer(): void {
    if (this.rosterTimer !== null) {
      clearTimeout(this.rosterTimer);
      this.rosterTimer = null;
    }
  }

  private clearSpeakingFlushTimer(): void {
    if (this.speakingFlushTimer !== null) {
      clearTimeout(this.speakingFlushTimer);
      this.speakingFlushTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearMeTimer();
    this.clearRosterTimer();
    this.clearSecondaryTimer();
    this.clearSpeakingFlushTimer();
    this.rosterArmed = false;
    this.secondaryArmed = false;
  }
}
