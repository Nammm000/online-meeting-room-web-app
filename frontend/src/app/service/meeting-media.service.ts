import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Room } from 'livekit-client';

/**
 * The LiveKit video plane behind a signal facade — the room service never
 * touches the SDK directly (SpeechDetectionService shape, so specs mock this
 * service via DI the same way). Video only: the microphone never publishes
 * here (audio is the Janus plane), which is also why speaking stays on
 * SpeechDetectionService — LiveKit's ActiveSpeakersChanged would never fire.
 *
 * Browser-only by construction: every SDK touch sits behind isPlatformBrowser
 * plus a dynamic import (SSR safety and bundle budget — the SDK never lands
 * in the initial chunk). In jsdom the media-device guards make camera/screen
 * calls silent no-ops, so unit tests need no device stubs.
 *
 * Connection model: `offerCredentials` is called by the room service on every
 * /me poll — a connected room just stores the freshest token (token grants
 * bind at connect time; the ~2 s re-mint exists for reconnects, whose
 * DB-derived grants then self-heal entitlements). Only a Disconnected event
 * while still armed triggers a reconnect, with backoff — never a grant change.
 */

/** Structural slice of LocalVideoTrack/RemoteVideoTrack the template/directive need. */
export interface VideoTrack {
  attach(element: HTMLMediaElement): HTMLMediaElement;
  detach(element?: HTMLMediaElement): HTMLMediaElement[];
}

/** The auto-subscription decision — pure so it is unit-testable without WebRTC. */
export function shouldAutoSubscribe(
  source: string,
  userId: number,
  clicked: ReadonlySet<number>,
): boolean {
  // The screen share is the one shared stream everyone watches; participant
  // cameras are strictly on-demand (click-to-view); nothing else subscribes.
  if (source === 'screen_share') {
    return true;
  }
  return source === 'camera' && clicked.has(userId);
}

/** The four picker reactions — native emoji chars, no icon assets. */
export const REACTIONS = [
  { key: 'heart', char: '❤️' },
  { key: 'laugh', char: '😂' },
  { key: 'cry', char: '😭' },
  { key: 'like', char: '👍' },
] as const;

export type ReactionKey = (typeof REACTIONS)[number]['key'];

/** The wire shape over the LiveKit data channel — the type discriminator keeps
 *  the channel open to future ephemeral events without a payload redesign. */
export interface ReactionPayload {
  type: 'reaction';
  reaction: ReactionKey;
}

/** One feed event from a remote participant; seq is monotonic per service instance. */
export interface IncomingReaction {
  seq: number;
  userId: number;
  reaction: ReactionKey;
}

const REACTION_KEYS: ReadonlySet<string> = new Set(REACTIONS.map((r) => r.key));
/** Feed cap — trimmed from the front; the seq high-water mark covers the loss. */
const REACTION_FEED_CAP = 30;

/** Pure codec halves — unit-testable without WebRTC (shouldAutoSubscribe precedent). */
export function encodeReaction(reaction: ReactionKey): Uint8Array<ArrayBuffer> {
  // The copy narrows ArrayBufferLike → ArrayBuffer (publishData's demand);
  // TextEncoder's own product is typed too loosely for it.
  const encoded = new TextEncoder().encode(JSON.stringify({ type: 'reaction', reaction }));
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

export function parseReaction(raw: Uint8Array): ReactionPayload | null {
  // NotificationService frame-validation precedent: shape-check, never trust.
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { type, reaction } = parsed as Record<string, unknown>;
    if (type !== 'reaction' || typeof reaction !== 'string' || !REACTION_KEYS.has(reaction)) {
      return null;
    }
    return { type, reaction: reaction as ReactionKey };
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class MeetingMediaService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly connectionState = signal<'idle' | 'connecting' | 'connected' | 'failed'>('idle');

  /** Per-session camera capture state — starts false, never auto-starts on (re)join. */
  readonly cameraPublishing = signal(false);
  readonly screenSharing = signal(false);

  readonly localCameraTrack = signal<VideoTrack | null>(null);
  /** Self-preview of the own screen share. */
  readonly localScreenTrack = signal<VideoTrack | null>(null);
  /** Subscribed remote camera tracks by userId — populated only on click. */
  readonly remoteCameraTracks = signal<ReadonlyMap<number, VideoTrack>>(new Map());
  readonly screenShareTrack = signal<{ userId: number; track: VideoTrack } | null>(null);

  /**
   * Remote reactions seen since connect — an append-only capped array, not a
   * single-event signal: signals batch within one change-detection flush, so
   * a burst of DataReceived events would collapse a scalar and keep only the
   * last. Each entry carries a monotonic seq (never reset, even across
   * meetings) so the room service diffs by high-water mark and survives the
   * trimming below.
   */
  readonly reactionFeed = signal<IncomingReaction[]>([]);
  private reactionSeq = 0;

  private room: Room | null = null;
  /** The dynamically imported module — cached so enum values (Track.Source) are reachable. */
  private livekit: typeof import('livekit-client') | null = null;
  private latestUrl: string | null = null;
  private latestToken: string | null = null;
  private armed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clicked = new Set<number>();

  /** Installs the freshest credentials; connects when armed and not already live. */
  offerCredentials(url: string, token: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.latestUrl = url;
    this.latestToken = token;
    this.armed = true;
    if (this.room === null && this.connectionState() !== 'connecting') {
      void this.connect();
    }
  }

  /** Full teardown — leave, stop publishing, clear every signal. */
  disconnect(): void {
    this.armed = false;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const room = this.room;
    this.room = null;
    this.clicked.clear();
    if (room !== null) {
      room.disconnect();
    }
    this.cameraPublishing.set(false);
    this.screenSharing.set(false);
    this.localCameraTrack.set(null);
    this.localScreenTrack.set(null);
    this.remoteCameraTracks.set(new Map());
    this.screenShareTrack.set(null);
    this.reactionFeed.set([]);
    this.connectionState.set('idle');
  }

  /** Publishes/unpublishes the camera (video only — the mic is Janus's). */
  async setCameraEnabled(enabled: boolean): Promise<void> {
    const room = this.room;
    if (room === null || !('mediaDevices' in navigator)) {
      return; // not connected, or jsdom/server — inert by contract
    }
    // LocalTrackPublished/Unpublished events flip the signals; the await here
    // surfaces getUserMedia denials to the caller.
    await room.localParticipant.setCameraEnabled(enabled);
  }

  /**
   * Publishes/unpublishes the screen share. The browser's native "Stop
   * sharing" bar ends the track, which lands in LocalTrackUnpublished below —
   * the room service watches screenSharing() and PATCHes the server release.
   */
  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    const room = this.room;
    if (room === null || !('mediaDevices' in navigator)) {
      return;
    }
    await room.localParticipant.setScreenShareEnabled(enabled);
  }

  /**
   * Broadcasts a reaction on the data channel (lossy by omission — a dropped
   * ephemeral publish is fine, and LiveKit recommends lossy for reactions).
   * Silent no-op when not connected, same contract as the camera calls. The
   * promise is swallowed on purpose: a session whose token predates the
   * data grant heals on the next reconnect, never on an error path.
   */
  publishReaction(reaction: ReactionKey): void {
    const room = this.room;
    if (room === null) {
      return;
    }
    void room.localParticipant.publishData(encodeReaction(reaction), { topic: 'reaction' }).catch(() => {});
  }

  /** Click-to-view: subscribes to that participant's camera from now on. */
  subscribeTo(userId: number): void {
    this.clicked.add(userId);
    this.reconcilePublications();
  }

  /** Click-again-to-hide: unsubscribes and drops the tile's track. */
  unsubscribeFrom(userId: number): void {
    this.clicked.delete(userId);
    const room = this.room;
    if (room === null || this.livekit === null) {
      return;
    }
    const participant = room.remoteParticipants.get(String(userId));
    participant
      ?.getTrackPublication(this.livekit.Track.Source.Camera)
      ?.setSubscribed(false);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    const url = this.latestUrl;
    const token = this.latestToken;
    if (url === null || token === null) {
      return;
    }
    this.connectionState.set('connecting');
    try {
      const livekit = await import('livekit-client');
      this.livekit = livekit;
      const room = new livekit.Room();
      this.wireEvents(room, livekit);
      // autoSubscribe is a connect option in v2 — false implements the
      // click-to-view contract (screen share excepted, via shouldAutoSubscribe).
      await room.connect(url, token, { autoSubscribe: false });
      this.room = room;
      this.reconnectAttempt = 0;
      this.connectionState.set('connected');
      // Participants already in the room arrived with the join snapshot —
      // their publications need the subscription decision replayed.
      this.reconcilePublications();
    } catch {
      this.connectionState.set('failed');
      if (this.armed) {
        this.scheduleReconnect();
      }
    }
  }

  private wireEvents(room: Room, livekit: typeof import('livekit-client')): void {
    const { RoomEvent, Track } = livekit;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const userId = Number(participant.identity);
      if (publication.source === Track.Source.Camera) {
        const next = new Map(this.remoteCameraTracks());
        next.set(userId, track as VideoTrack);
        this.remoteCameraTracks.set(next);
      } else if (publication.source === Track.Source.ScreenShare) {
        this.screenShareTrack.set({ userId, track: track as VideoTrack });
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
      const userId = Number(participant.identity);
      if (publication.source === Track.Source.Camera) {
        const next = new Map(this.remoteCameraTracks());
        next.delete(userId);
        this.remoteCameraTracks.set(next);
      } else if (publication.source === Track.Source.ScreenShare) {
        const current = this.screenShareTrack();
        if (current !== null && current.userId === userId) {
          this.screenShareTrack.set(null);
        }
      }
    });

    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      const userId = Number(participant.identity);
      if (shouldAutoSubscribe(String(publication.source), userId, this.clicked)) {
        publication.setSubscribed(true);
      }
    });

    // Reactions: payload + participant only — the JSON discriminator is the
    // authoritative filter, so kind/topic are left unread. identity is the
    // server-minted users.id (never client-chosen), trusted as the sender.
    room.on(RoomEvent.DataReceived, (payload, participant) => {
      const parsed = parseReaction(payload);
      if (parsed === null || participant === undefined) {
        return;
      }
      const userId = Number(participant.identity);
      if (!Number.isFinite(userId)) {
        return;
      }
      this.reactionSeq += 1;
      this.reactionFeed.update((feed) =>
        [...feed, { seq: this.reactionSeq, userId, reaction: parsed.reaction }].slice(-REACTION_FEED_CAP),
      );
    });

    // Local events carry (publication, participant) — the track hangs off the publication.
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.source === Track.Source.Camera) {
        this.localCameraTrack.set(publication.videoTrack ?? null);
        this.cameraPublishing.set(true);
      } else if (publication.source === Track.Source.ScreenShare) {
        this.localScreenTrack.set(publication.videoTrack ?? null);
        this.screenSharing.set(true);
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.Camera) {
        this.localCameraTrack.set(null);
        this.cameraPublishing.set(false);
      } else if (publication.source === Track.Source.ScreenShare) {
        this.localScreenTrack.set(null);
        this.screenSharing.set(false); // includes the browser's native stop bar
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      if (this.room === room) {
        this.room = null;
        this.remoteCameraTracks.set(new Map());
        this.screenShareTrack.set(null);
        this.localCameraTrack.set(null);
        this.localScreenTrack.set(null);
        this.cameraPublishing.set(false);
        this.screenSharing.set(false);
        this.reactionFeed.set([]);
      }
      if (this.armed) {
        this.connectionState.set('failed');
        this.scheduleReconnect();
      } else {
        this.connectionState.set('idle');
      }
    });
  }

  /** Applies the click-to-view decision to every currently known publication. */
  private reconcilePublications(): void {
    const room = this.room;
    if (room === null) {
      return;
    }
    for (const participant of room.remoteParticipants.values()) {
      const userId = Number(participant.identity);
      for (const publication of participant.trackPublications.values()) {
        if (shouldAutoSubscribe(String(publication.source), userId, this.clicked)) {
          publication.setSubscribed(true);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.armed && this.room === null) {
        void this.connect();
      }
    }, delay);
  }
}
