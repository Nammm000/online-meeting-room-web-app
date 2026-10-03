import { isPlatformBrowser } from '@angular/common';
import {
  Injectable,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';

/** RMS at/above which sustained audio counts as speaking (time-domain, 0..1). */
export const SPEAKING_ON_RMS = 0.045;
/** RMS at/below which sustained silence counts as not speaking. */
export const SPEAKING_OFF_RMS = 0.015;
/** Consecutive loud ticks needed to flip silent → speaking. */
export const SPEAKING_ON_TICKS = 2;
/** Consecutive quiet ticks (~0.8 s hangover) needed to flip speaking → silent, so word gaps don't flap. */
export const SPEAKING_OFF_TICKS = 8;

/**
 * One hysteresis step of the speaking decision, pure so it is unit-testable
 * in jsdom (no Web Audio there). `sustainedTicks` counts consecutive readings
 * on the far side of the current state; it resets on any flip or mixed reading.
 */
export function nextSpeakingState(
  rms: number,
  current: boolean,
  sustainedTicks: number,
): { speaking: boolean; sustainedTicks: number } {
  if (!current && rms >= SPEAKING_ON_RMS) {
    const ticks = sustainedTicks + 1;
    return ticks >= SPEAKING_ON_TICKS
      ? { speaking: true, sustainedTicks: 0 }
      : { speaking: false, sustainedTicks: ticks };
  }
  if (current && rms <= SPEAKING_OFF_RMS) {
    const ticks = sustainedTicks + 1;
    return ticks >= SPEAKING_OFF_TICKS
      ? { speaking: false, sustainedTicks: 0 }
      : { speaking: true, sustainedTicks: ticks };
  }
  return { speaking: current, sustainedTicks: 0 };
}

/**
 * Local mic-energy speech detection feeding the speaking indicator (until the
 * WebRTC milestone, this is the only voice signal that exists). Runs a
 * getUserMedia + AnalyserNode loop while started and reports a plain boolean —
 * the room service forwards transitions over REST and throttles them against
 * the rate budget.
 *
 * Browser-only, NotificationService-style: on the server (and anywhere
 * `mediaDevices` is missing — jsdom, denied permission, no devices) the
 * service is an inert signal holder; a failed start disables it permanently
 * and silently, never surfacing an error for what is a cosmetic feature.
 */
@Injectable({ providedIn: 'root' })
export class SpeechDetectionService {
  private static readonly TICK_MS = 100;

  private readonly platformId = inject(PLATFORM_ID);

  private readonly _speaking = signal(false);
  /** The local user is (per mic energy) currently speaking. */
  readonly speaking = this._speaking.asReadonly();

  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sustainedTicks = 0;
  private starting = false;
  /** A failed start (denied permission, no mic) — retrying would just re-prompt. */
  private unavailable = false;

  /** Starts analysis if possible; idempotent while running or starting. */
  start(): void {
    if (
      this.timer !== null ||
      this.starting ||
      this.unavailable ||
      !isPlatformBrowser(this.platformId) ||
      !('mediaDevices' in navigator)
    ) {
      return;
    }
    this.starting = true;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => this.onStream(stream))
      .catch(() => {
        this.unavailable = true;
      })
      .finally(() => {
        this.starting = false;
      });
  }

  /** Stops analysis, releases the mic, and clears the flag; idempotent. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stream !== null) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.audioContext !== null) {
      this.audioContext.close().catch(() => {
        // already closed / never allowed to run — nothing to release
      });
      this.audioContext = null;
    }
    this.analyser = null;
    this.sustainedTicks = 0;
    this._speaking.set(false);
  }

  private onStream(stream: MediaStream): void {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioContextCtor === undefined) {
      stream.getTracks().forEach((track) => track.stop());
      this.unavailable = true;
      return;
    }
    const context = new AudioContextCtor();
    if (context.state === 'suspended') {
      context.resume().catch(() => {
        this.unavailable = true; // autoplay policy — permanently inert
      });
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);

    this.stream = stream;
    this.audioContext = context;
    this.analyser = analyser;
    this.sustainedTicks = 0;
    this.timer = setInterval(
      () => this.tick(),
      SpeechDetectionService.TICK_MS,
    );
  }

  private tick(): void {
    const analyser = this.analyser;
    if (analyser === null) {
      return;
    }
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / samples.length);
    const next = nextSpeakingState(rms, this._speaking(), this.sustainedTicks);
    this.sustainedTicks = next.sustainedTicks;
    this._speaking.set(next.speaking);
  }
}
