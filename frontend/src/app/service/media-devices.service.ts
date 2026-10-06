import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

/** Splits enumerateDevices() output by kind — pure, jsdom-testable. */
export function devicesByKind(list: MediaDeviceInfo[]): {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
} {
  const mics: MediaDeviceInfo[] = [];
  const cameras: MediaDeviceInfo[] = [];
  const speakers: MediaDeviceInfo[] = [];
  for (const device of list) {
    if (device.kind === 'audioinput') {
      mics.push(device);
    } else if (device.kind === 'videoinput') {
      cameras.push(device);
    } else if (device.kind === 'audiooutput') {
      speakers.push(device);
    }
  }
  return { mics, cameras, speakers };
}

/**
 * Pre-join camera preview + device enumeration — the local-media half of the
 * device story, beside the LiveKit facade (MeetingMediaService), which only
 * exists once a room connection does. Never connects anything: the preview is
 * a plain getUserMedia stream the pre-join screen binds to a `<video>`
 * directly, and the mic/camera/speaker selections live here for whichever
 * capture path consumes them (SpeechDetectionService reads the mic id;
 * camera/speaker application waits on LiveKit publish wiring).
 *
 * Browser-only, SpeechDetectionService-style: on the server (and anywhere
 * `mediaDevices` is missing — jsdom) the service is an inert signal holder.
 * The preview is gesture-first — `init()` only enumerates; the camera
 * permission prompt fires when the user flips the camera toggle.
 */
@Injectable({ providedIn: 'root' })
export class MediaDevicesService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly mics = signal<MediaDeviceInfo[]>([]);
  readonly cameras = signal<MediaDeviceInfo[]>([]);
  readonly speakers = signal<MediaDeviceInfo[]>([]);

  readonly micDeviceId = signal<string | null>(null);
  readonly cameraDeviceId = signal<string | null>(null);
  readonly speakerDeviceId = signal<string | null>(null);

  /** Pre-join mic choice — the join-time seed for self-mute. */
  readonly micEnabled = signal(true);
  /** Whether the preview should run — starts off (gesture-first, no prompt on entry). */
  readonly cameraEnabled = signal(false);
  /** getUserMedia failed (denied/absent camera) — hint instead of a blank frame. */
  readonly cameraBlocked = signal(false);
  readonly previewStream = signal<MediaStream | null>(null);

  /**
   * Permission API states for the two gated selects. 'unknown' = the API is
   * missing or rejects camera/microphone names (Safari, jsdom, SSR) — selects
   * keep their device lists there; only a live preview grant/deny can move the
   * camera state in 'unknown'-land.
   */
  readonly micPermission = signal<PermissionState | 'unknown'>('unknown');
  readonly cameraPermission = signal<PermissionState | 'unknown'>('unknown');

  private stream: MediaStream | null = null;
  private deviceListener: (() => void) | null = null;
  private permissionStatuses: PermissionStatus[] = [];
  private starting = false;

  /** Enumerates devices and arms the hot-plug listener; never prompts. Idempotent. */
  init(): void {
    if (!this.supported()) {
      return;
    }
    if (this.deviceListener === null) {
      const listener = (): void => void this.enumerate();
      navigator.mediaDevices.addEventListener('devicechange', listener);
      this.deviceListener = listener;
    }
    this.refreshPermissions();
    void this.enumerate();
  }

  /**
   * Queries the two permission states the selects gate on. query() never
   * prompts — it only reads the browser's remembered decision — so the
   * gesture-first contract holds. Re-callable: stale onchange hooks are
   * disarmed first.
   */
  private refreshPermissions(): void {
    if (!isPlatformBrowser(this.platformId) || navigator.permissions === undefined) {
      return;
    }
    for (const status of this.permissionStatuses) {
      status.onchange = null;
    }
    this.permissionStatuses = [];
    void this.queryPermission('camera', (state) => this.cameraPermission.set(state));
    void this.queryPermission('microphone', (state) => this.micPermission.set(state));
  }

  private async queryPermission(
    name: 'camera' | 'microphone',
    set: (state: PermissionState) => void,
  ): Promise<void> {
    let status: PermissionStatus;
    try {
      status = await navigator.permissions.query({ name });
    } catch {
      return; // unsupported name (Safari) — stay 'unknown'
    }
    set(status.state);
    this.permissionStatuses.push(status);
    status.onchange = () => set(status.state);
  }

  /** Refreshes the three device lists, re-defaulting selections that vanished. */
  async enumerate(): Promise<void> {
    if (!this.supported()) {
      return;
    }
    let list: MediaDeviceInfo[];
    try {
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return; // transient failure — the next devicechange/init retries
    }
    if (!Array.isArray(list)) {
      return; // shape-shy guard — never let a bad payload break the caller
    }
    const { mics, cameras, speakers } = devicesByKind(list);
    this.mics.set(mics);
    this.cameras.set(cameras);
    this.speakers.set(speakers);
    if (mics.length > 0 && !mics.some((device) => device.deviceId === this.micDeviceId())) {
      this.micDeviceId.set(mics[0]!.deviceId);
    }
    if (
      speakers.length > 0 &&
      !speakers.some((device) => device.deviceId === this.speakerDeviceId())
    ) {
      this.speakerDeviceId.set(speakers[0]!.deviceId);
    }
    const cameraGone =
      cameras.length > 0 && !cameras.some((device) => device.deviceId === this.cameraDeviceId());
    if (cameras.length === 0) {
      this.cameraDeviceId.set(null);
    } else if (cameraGone) {
      this.cameraDeviceId.set(cameras[0]!.deviceId);
    }
    if (cameraGone && this.cameraEnabled()) {
      // Unplug while previewing — follow the selection to a surviving camera.
      void this.startPreview(this.cameraDeviceId() ?? undefined);
    }
  }

  /** Mic choice is preference-only pre-join (audio capture is Janus-side). */
  setMicEnabled(enabled: boolean): void {
    this.micEnabled.set(enabled);
  }

  toggleMic(): void {
    this.setMicEnabled(!this.micEnabled());
  }

  /** `true` is the permission gesture — the only path that ever prompts. */
  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.cameraEnabled()) {
      return;
    }
    if (!enabled) {
      this.cameraEnabled.set(false);
      this.stopPreview();
      return;
    }
    this.cameraEnabled.set(true);
    await this.startPreview(this.cameraDeviceId() ?? undefined);
  }

  toggleCamera(): Promise<void> {
    return this.setCameraEnabled(!this.cameraEnabled());
  }

  selectMic(deviceId: string): void {
    this.micDeviceId.set(deviceId);
  }

  selectSpeaker(deviceId: string): void {
    this.speakerDeviceId.set(deviceId);
  }

  /** Switching cameras live-restarts the preview (permission already granted). */
  selectCamera(deviceId: string): void {
    if (deviceId === this.cameraDeviceId()) {
      return;
    }
    this.cameraDeviceId.set(deviceId);
    if (this.cameraEnabled()) {
      void this.startPreview(deviceId);
    }
  }

  /**
   * Leaving the pre-join screen: release the camera and the hot-plug listener,
   * but keep the mic choice and selections — they are the join-time seeds.
   */
  release(): void {
    this.stopPreview();
    this.cameraEnabled.set(false); // the next pre-join visit is gesture-first again
    this.cameraBlocked.set(false);
    for (const status of this.permissionStatuses) {
      status.onchange = null;
    }
    this.permissionStatuses = [];
    if (this.deviceListener !== null && this.supported()) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceListener);
      this.deviceListener = null;
    }
  }

  private async startPreview(deviceId: string | undefined): Promise<void> {
    if (!this.supported() || this.starting) {
      return;
    }
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId !== undefined ? { deviceId: { ideal: deviceId } } : true,
        audio: false, // video-only preview: one prompt, no mic capture before join
      });
      this.stopPreview(); // camera switch — retire the previous stream
      this.stream = stream;
      this.previewStream.set(stream);
      this.cameraBlocked.set(false);
      this.cameraPermission.set('granted'); // direct evidence, even without the API
      const [track] = stream.getVideoTracks();
      if (track !== undefined) {
        track.addEventListener('ended', () => {
          // unplugged/OS-revoked — nothing to preview, but not "blocked"
          this.cameraEnabled.set(false);
          this.stopPreview();
        });
        const settings = track.getSettings();
        if (settings.deviceId !== undefined && settings.deviceId !== '') {
          this.cameraDeviceId.set(settings.deviceId); // the device the browser actually chose
        }
      }
      await this.enumerate(); // the grant unlocks labels — refresh them
    } catch {
      this.cameraBlocked.set(true);
      this.cameraEnabled.set(false);
      this.cameraPermission.set('denied');
    } finally {
      this.starting = false;
    }
  }

  private stopPreview(): void {
    if (this.stream !== null) {
      this.stream.getTracks().forEach((track) => track.stop()); // releases the camera light
      this.stream = null;
    }
    this.previewStream.set(null);
  }

  private supported(): boolean {
    return isPlatformBrowser(this.platformId) && 'mediaDevices' in navigator;
  }
}
