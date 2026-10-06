import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { MediaDevicesService, devicesByKind } from './media-devices.service';

function fakeDevice(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'group' } as MediaDeviceInfo;
}

function fakeTrack(deviceId: string): MediaStreamTrack {
  return {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    getSettings: () => ({ deviceId }),
  } as unknown as MediaStreamTrack;
}

function fakeStream(track: MediaStreamTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

/** jsdom has no mediaDevices — install a full stub, return it for per-test setup. */
function stubMediaDevices(): {
  enumerateDevices: ReturnType<typeof vi.fn>;
  getUserMedia: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
} {
  const mediaDevices = {
    enumerateDevices: vi.fn(),
    getUserMedia: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
  return mediaDevices;
}

/** jsdom has no permissions either — install a query stub, return it for setup. */
function stubPermissions(
  states: { camera?: PermissionState; microphone?: PermissionState } = {},
): ReturnType<typeof vi.fn> {
  const query = vi.fn(async (descriptor: PermissionDescriptor) => ({
    state: states[descriptor.name as 'camera' | 'microphone'] ?? 'prompt',
    onchange: null,
  }));
  Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true });
  return query;
}

/** Flushes pending microtask chains (init()'s fire-and-forget enumerate). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Grants whatever camera was asked for — the track reports the requested id. */
function echoUserMedia(
  mediaDevices: ReturnType<typeof stubMediaDevices>,
): void {
  mediaDevices.getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
    const video = constraints.video;
    const ideal =
      typeof video === 'object' && video !== null && video.deviceId !== undefined
        ? String((video.deviceId as { ideal: string | string[] }).ideal)
        : 'default';
    return fakeStream(fakeTrack(ideal));
  });
}

describe('devicesByKind (pure splitter)', () => {
  it('splits a mixed device list into mic/camera/speaker buckets', () => {
    const mic = fakeDevice('audioinput', 'm1');
    const camera = fakeDevice('videoinput', 'c1');
    const speaker = fakeDevice('audiooutput', 's1');
    expect(devicesByKind([mic, camera, speaker])).toEqual({
      mics: [mic],
      cameras: [camera],
      speakers: [speaker],
    });
  });

  it('returns empty buckets for an empty list and keeps bucket order stable', () => {
    expect(devicesByKind([])).toEqual({ mics: [], cameras: [], speakers: [] });
    const a = fakeDevice('audioinput', 'm1');
    const b = fakeDevice('audioinput', 'm2');
    expect(devicesByKind([a, b]).mics).toEqual([a, b]);
  });
});

describe('MediaDevicesService', () => {
  afterEach(() => {
    // A prior test's permissions stub must not leak into the missing-API tests.
    delete (navigator as { permissions?: unknown }).permissions;
  });

  it('is inert on the server platform', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const service = TestBed.inject(MediaDevicesService);
    service.init();
    void service.setCameraEnabled(true);
    service.release(); // idempotent, no throw
    expect(service.mics()).toEqual([]);
    expect(service.previewStream()).toBeNull();
    expect(service.cameraEnabled()).toBe(false);
  });

  it('no-ops init on a browser platform without mediaDevices (jsdom)', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const service = TestBed.inject(MediaDevicesService);
    service.init();
    await flush();
    expect(service.cameras()).toEqual([]); // silent no-op, no throw
  });

  it('init() enumerates, defaults selections, and never prompts (gesture-first)', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    mediaDevices.enumerateDevices.mockResolvedValue([
      fakeDevice('audioinput', 'm1'),
      fakeDevice('videoinput', 'c1'),
      fakeDevice('audiooutput', 's1'),
    ]);

    service.init();
    await flush();

    expect(service.micDeviceId()).toBe('m1');
    expect(service.cameraDeviceId()).toBe('c1');
    expect(service.speakerDeviceId()).toBe('s1');
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled(); // no camera prompt on entry
    expect(mediaDevices.addEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
    expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(1); // listener armed once

    service.init(); // idempotent — no second listener
    expect(mediaDevices.addEventListener).toHaveBeenCalledTimes(1);
    service.release();
  });

  it('setCameraEnabled(true) starts the preview, seeds the actual device, and refreshes labels', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    const track = fakeTrack('c2');
    const stream = fakeStream(track);
    mediaDevices.getUserMedia.mockResolvedValue(stream);
    mediaDevices.enumerateDevices.mockResolvedValue([
      fakeDevice('videoinput', 'c1', 'Front camera'),
      fakeDevice('videoinput', 'c2', 'Rear camera'),
    ]);

    await service.setCameraEnabled(true);

    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(service.previewStream()).toBe(stream);
    expect(service.cameraEnabled()).toBe(true);
    expect(service.cameraBlocked()).toBe(false);
    expect(service.cameraDeviceId()).toBe('c2'); // from track.getSettings()
    expect(service.cameras()[1]!.label).toBe('Rear camera'); // post-grant re-enumeration
    expect(track.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    service.release();
  });

  it('a denied camera marks cameraBlocked and reverts the toggle', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    mediaDevices.getUserMedia.mockRejectedValue(new DOMException('Permission denied'));

    await service.setCameraEnabled(true);

    expect(service.cameraBlocked()).toBe(true);
    expect(service.cameraEnabled()).toBe(false);
    expect(service.previewStream()).toBeNull();
    service.release();
  });

  it('setCameraEnabled(false) stops the tracks — the camera light goes off', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    const track = fakeTrack('c1');
    mediaDevices.getUserMedia.mockResolvedValue(fakeStream(track));
    mediaDevices.enumerateDevices.mockResolvedValue([fakeDevice('videoinput', 'c1')]);

    await service.setCameraEnabled(true);
    await service.setCameraEnabled(false);

    expect(track.stop).toHaveBeenCalled();
    expect(service.previewStream()).toBeNull();
    expect(service.cameraEnabled()).toBe(false);
    service.release();
  });

  it('selectCamera live-restarts the preview only while the camera is enabled', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    echoUserMedia(mediaDevices);
    mediaDevices.enumerateDevices.mockResolvedValue([
      fakeDevice('videoinput', 'c1'),
      fakeDevice('videoinput', 'c2'),
    ]);

    service.selectCamera('c2'); // preview off — choice stored, no capture
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(service.cameraDeviceId()).toBe('c2');

    await service.setCameraEnabled(true); // starts with the stored choice
    expect(mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { ideal: 'c2' } },
      audio: false,
    });

    service.selectCamera('c1'); // enabled — restarts with the new device
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { ideal: 'c1' } },
      audio: false,
    });
    service.release();
  });

  it('enumerate() re-defaults a vanished camera and follows a running preview to a survivor', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    echoUserMedia(mediaDevices);
    mediaDevices.enumerateDevices.mockResolvedValueOnce([
      fakeDevice('videoinput', 'c1'),
      fakeDevice('videoinput', 'c2'),
    ]);

    service.selectCamera('c1'); // stored choice — startPreview asks for it by id
    await service.setCameraEnabled(true);
    expect(service.cameraDeviceId()).toBe('c1');

    mediaDevices.enumerateDevices.mockResolvedValueOnce([fakeDevice('videoinput', 'c2')]); // c1 unplugged
    await service.enumerate();

    expect(service.cameraDeviceId()).toBe('c2');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2); // preview followed over
    service.release();
  });

  it('release() releases the camera and disarms the hot-plug listener but keeps the mic seed', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);
    const track = fakeTrack('c1');
    mediaDevices.getUserMedia.mockResolvedValue(fakeStream(track));
    mediaDevices.enumerateDevices.mockResolvedValue([fakeDevice('videoinput', 'c1')]);
    service.init(); // arms the hot-plug listener release() must disarm
    await flush();
    await service.setCameraEnabled(true);
    service.setMicEnabled(false);

    service.release();

    expect(track.stop).toHaveBeenCalled();
    expect(service.cameraEnabled()).toBe(false);
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
    expect(service.micEnabled()).toBe(false); // survives — the join-time seed
    expect(service.cameraDeviceId()).toBe('c1'); // survives too
  });

  it('mic toggling is preference-only — no capture is ever started', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    const service = TestBed.inject(MediaDevicesService);

    service.toggleMic();
    expect(service.micEnabled()).toBe(false);
    service.toggleMic();
    expect(service.micEnabled()).toBe(true);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    service.release();
  });

  it('init() reads both permission states without ever prompting', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    stubMediaDevices();
    stubPermissions({ camera: 'prompt', microphone: 'denied' });
    const service = TestBed.inject(MediaDevicesService);

    service.init();
    await flush();

    expect(service.cameraPermission()).toBe('prompt');
    expect(service.micPermission()).toBe('denied');
    service.release();
  });

  it('a permission change updates the signal live via onchange', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    stubMediaDevices();
    const query = stubPermissions();
    // One status per name — the browser returns distinct PermissionStatuses.
    const cameraStatus = { state: 'prompt' as PermissionState, onchange: null as null | (() => void) };
    query.mockImplementation(async (descriptor: PermissionDescriptor) =>
      descriptor.name === 'camera'
        ? cameraStatus
        : { state: 'prompt' as PermissionState, onchange: null },
    );
    const service = TestBed.inject(MediaDevicesService);

    service.init();
    await flush();
    expect(service.cameraPermission()).toBe('prompt');

    cameraStatus.state = 'granted'; // the user flips the site setting mid-session
    cameraStatus.onchange?.();
    expect(service.cameraPermission()).toBe('granted');
    service.release();
  });

  it('stays unknown where the permissions API is missing (jsdom/SSR)', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    mediaDevices.enumerateDevices.mockResolvedValue([fakeDevice('audioinput', 'm1')]);
    const service = TestBed.inject(MediaDevicesService);

    service.init();
    await flush();

    expect(service.micPermission()).toBe('unknown');
    expect(service.cameraPermission()).toBe('unknown');
    expect(service.mics()).toHaveLength(1); // enumeration is unaffected
    service.release();
  });

  it('a rejecting query (Safari names) stays unknown', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    stubMediaDevices();
    const query = stubPermissions();
    query.mockRejectedValue(new TypeError('The provided name is not supported'));
    const service = TestBed.inject(MediaDevicesService);

    service.init();
    await flush();

    expect(service.cameraPermission()).toBe('unknown');
    expect(service.micPermission()).toBe('unknown');
    service.release();
  });

  it('a preview grant/deny sets the camera state without any permissions API', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const mediaDevices = stubMediaDevices();
    mediaDevices.enumerateDevices.mockResolvedValue([fakeDevice('videoinput', 'c1')]);
    const service = TestBed.inject(MediaDevicesService);

    mediaDevices.getUserMedia.mockResolvedValue(fakeStream(fakeTrack('c1')));
    await service.setCameraEnabled(true);
    expect(service.cameraPermission()).toBe('granted');

    service.release(); // leaves the prejoin screen — the toggle is gesture-first again
    mediaDevices.getUserMedia.mockRejectedValue(new DOMException('Permission denied'));
    await service.setCameraEnabled(true);
    expect(service.cameraPermission()).toBe('denied');
    service.release();
  });

  it('release() disarms the permission watchers', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    stubMediaDevices();
    const query = stubPermissions();
    const status = { state: 'prompt' as PermissionState, onchange: null as null | (() => void) };
    query.mockResolvedValue(status);
    const service = TestBed.inject(MediaDevicesService);

    service.init();
    await flush();
    service.release();

    status.state = 'granted';
    status.onchange?.(); // disarmed — the signal must not move
    expect(service.cameraPermission()).toBe('prompt');
  });
});
