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
