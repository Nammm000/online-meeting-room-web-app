import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import {
  SPEAKING_OFF_RMS,
  SPEAKING_OFF_TICKS,
  SPEAKING_ON_RMS,
  SPEAKING_ON_TICKS,
  SpeechDetectionService,
  nextSpeakingState,
} from './speech-detection.service';

describe('nextSpeakingState (pure hysteresis)', () => {
  it('flips to speaking only after sustained loud readings', () => {
    let state = { speaking: false, sustainedTicks: 0 };
    for (let i = 1; i < SPEAKING_ON_TICKS; i++) {
      state = nextSpeakingState(SPEAKING_ON_RMS, state.speaking, state.sustainedTicks);
      expect(state).toEqual({ speaking: false, sustainedTicks: i });
    }
    state = nextSpeakingState(SPEAKING_ON_RMS, state.speaking, state.sustainedTicks);
    expect(state).toEqual({ speaking: true, sustainedTicks: 0 });
  });

  it('flips back to silent only after sustained quiet (the hangover)', () => {
    let state = { speaking: true, sustainedTicks: 0 };
    for (let i = 1; i < SPEAKING_OFF_TICKS; i++) {
      state = nextSpeakingState(SPEAKING_OFF_RMS, state.speaking, state.sustainedTicks);
      expect(state).toEqual({ speaking: true, sustainedTicks: i });
    }
    state = nextSpeakingState(SPEAKING_OFF_RMS, state.speaking, state.sustainedTicks);
    expect(state).toEqual({ speaking: false, sustainedTicks: 0 });
  });

  it('holds the current state in the dead zone between thresholds', () => {
    const mid = (SPEAKING_OFF_RMS + SPEAKING_ON_RMS) / 2;
    expect(nextSpeakingState(mid, false, SPEAKING_ON_TICKS - 1)).toEqual({
      speaking: false,
      sustainedTicks: 0, // a mixed reading resets the counter
    });
    expect(nextSpeakingState(mid, true, SPEAKING_OFF_TICKS - 1)).toEqual({
      speaking: true,
      sustainedTicks: 0,
    });
  });

  it('keeps quiet-below-threshold readings from waking a silent mic', () => {
    expect(nextSpeakingState(SPEAKING_OFF_RMS, false, 5)).toEqual({
      speaking: false,
      sustainedTicks: 0,
    });
  });
});

describe('SpeechDetectionService', () => {
  it('is inert on the server and anywhere mediaDevices is missing', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const service = TestBed.inject(SpeechDetectionService);
    service.start();
    expect(service.speaking()).toBe(false); // no throw, no analysis
    service.stop(); // idempotent
    expect(service.speaking()).toBe(false);
  });

  it('no-ops on a browser platform without mediaDevices (jsdom, denied permission)', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const service = TestBed.inject(SpeechDetectionService);
    // jsdom exposes no mediaDevices — the same guard that covers a hardened
    // browser must make start() a silent no-op.
    service.start();
    await Promise.resolve();
    expect(service.speaking()).toBe(false);
  });
});
