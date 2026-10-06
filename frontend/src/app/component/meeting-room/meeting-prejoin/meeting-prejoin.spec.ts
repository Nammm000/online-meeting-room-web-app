import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { MeetingPrejoin } from './meeting-prejoin';
import { MeetingRoomService } from 'service/meeting-room.service';
import { MeetingMediaService } from 'service/meeting-media.service';
import type { IncomingReaction } from 'service/meeting-media.service';
import { MediaDevicesService } from 'service/media-devices.service';
import { StageAvatarService } from 'service/stage-avatar.service';
import { AuthService } from 'service/auth.service';
import type { JwtClaims } from 'util/jwt-util';
import type { MyMeetingStatus, Participant } from 'model/meeting.model';
import type { UserWrapper } from 'model/user.model';

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(claims: Partial<JwtClaims> = {}): string {
  const full: JwtClaims = {
    sub: 'bob@test.com',
    role: 'ROLE_USER',
    iat: 1000,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `header.${base64Url(JSON.stringify(full))}.signature`;
}

const CODE = 'ABCDEFGHJK';
const BASE_URL = `${environment.apiUrl}/meetings/${CODE}`;

const rejoinParticipant = (status: Participant['status']): Participant => ({
  userId: 2,
  name: 'Bob Rejoin',
  email: 'bob@t.dev',
  role: 'PARTICIPANT',
  status,
  muted: false,
  videoEnabled: true,
  speaking: false,
  handRaised: false,
  joinCount: 1,
  firstJoinedAt: null,
  lastJoinedAt: null,
  lastLeftAt: null,
  lastSpeakingAt: null,
  lastHandRaisedAt: null,
  admittedByName: null,
});

/** /me with no participant row — the store's `preJoin` view state. */
const preJoinStatus: MyMeetingStatus = {
  meeting: {
    id: 1,
    joinCode: CODE,
    title: 'Standup',
    description: null,
    type: 'INSTANT',
    status: 'IN_PROGRESS',
    scheduledStartAt: null,
    scheduledEndAt: null,
    actualStartAt: '2026-10-02T09:00:00',
    endedAt: null,
    createdAt: '2026-10-02T08:00:00',
    waitingRoomEnabled: false,
    muteOnEntry: false,
    locked: false,
    hasPassword: false,
    screenSharerUserId: null,
    hostId: 1,
    hostName: 'Alice',
    media: null,
  },
  participant: null,
  media: null,
};

const currentUser: UserWrapper = {
  id: 2,
  name: 'Bob Builder',
  email: 'bob@test.com',
  phone: '',
  status: 'ACTIVE',
  createdTime: '2026-01-01T00:00:00',
  role: 'ROLE_USER',
};

function fakeDevice(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'group' } as MediaDeviceInfo;
}

describe('MeetingPrejoin', () => {
  let component: MeetingPrejoin;
  let fixture: ComponentFixture<MeetingPrejoin>;
  let httpMock: HttpTestingController;
  let roomService: MeetingRoomService;

  /** Inert facade/avatar mocks — the real room store runs against HttpTestingController. */
  const mediaFacadeMock = {
    connectionState: signal<'idle' | 'connecting' | 'connected' | 'failed'>('idle'),
    cameraPublishing: signal(false),
    screenSharing: signal(false),
    localCameraTrack: signal<unknown | null>(null),
    localScreenTrack: signal<unknown | null>(null),
    remoteCameraTracks: signal<ReadonlyMap<number, unknown>>(new Map()),
    screenShareTrack: signal<unknown | null>(null),
    reactionFeed: signal<IncomingReaction[]>([]),
    offerCredentials: vi.fn(),
    disconnect: vi.fn(),
    setCameraEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
    publishReaction: vi.fn(),
    subscribeTo: vi.fn(),
    unsubscribeFrom: vi.fn(),
  };
  const stageAvatarMock = {
    urls: signal<ReadonlyMap<number, string>>(new Map()),
    urlFor: (): null => null,
    ensureLoaded: vi.fn(),
    clearAll: vi.fn(),
  };
  const devicesMock = {
    mics: signal<MediaDeviceInfo[]>([]),
    cameras: signal<MediaDeviceInfo[]>([]),
    speakers: signal<MediaDeviceInfo[]>([]),
    micDeviceId: signal<string | null>(null),
    cameraDeviceId: signal<string | null>(null),
    speakerDeviceId: signal<string | null>(null),
    micEnabled: signal(true),
    cameraEnabled: signal(false),
    cameraBlocked: signal(false),
    previewStream: signal<MediaStream | null>(null),
    micPermission: signal<PermissionState | 'unknown'>('unknown'),
    cameraPermission: signal<PermissionState | 'unknown'>('unknown'),
    init: vi.fn(),
    release: vi.fn(),
    setMicEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    selectMic: vi.fn(),
    selectCamera: vi.fn(),
    selectSpeaker: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeetingPrejoin],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MeetingMediaService, useValue: mediaFacadeMock },
        { provide: StageAvatarService, useValue: stageAvatarMock },
        { provide: MediaDevicesService, useValue: devicesMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingPrejoin);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    roomService = TestBed.inject(MeetingRoomService);
    // A live session, or the store's logout effect stops any started room.
    TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken() });
  });

  afterEach(() => {
    roomService.stop();
    httpMock.verify();
  });

  /** Opens the room in the pre-join state and satisfies the identity load. */
  const renderPreJoin = (status: MyMeetingStatus = preJoinStatus): void => {
    roomService.start(CODE);
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/me`)
      .flush(status);
    fixture.detectChanges(); // ngOnInit → devices.init() + /users/current-user
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${environment.apiUrl}/users/current-user`)
      .flush(currentUser);
    fixture.detectChanges();
  };

  it('initializes the device service and renders room facts (title, code, badge, hint)', () => {
    renderPreJoin();
    const root = fixture.nativeElement as HTMLElement;

    expect(devicesMock.init).toHaveBeenCalled();
    expect(root.querySelector('.prejoin__title')!.textContent).toContain('Standup');
    expect(root.querySelector('.prejoin__code-value')!.textContent).toContain(CODE);
    expect(root.querySelector('.prejoin__meta .badge')!.classList).toContain('badge--in_progress');
    expect(root.querySelector('.prejoin__hint')).not.toBeNull();
  });

  it('renders locked/password badges for protected meetings', () => {
    renderPreJoin({
      ...preJoinStatus,
      meeting: {
        ...preJoinStatus.meeting,
        locked: true,
        hasPassword: true,
      },
    });
    const badges = (fixture.nativeElement as HTMLElement).querySelectorAll('.prejoin__meta .badge');
    expect(badges).toHaveLength(3); // status + locked + password
  });

  it('renders the joining identity from /users/current-user with initials avatar', () => {
    renderPreJoin();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.prejoin__user-name')!.textContent).toContain('Bob Builder');
    expect(root.querySelector('.prejoin__user-avatar')!.textContent!.trim()).toBe('BB');
    expect(root.querySelector('.prejoin__avatar')!.textContent!.trim()).toBe('BB');
  });

  it('seeds the identity from a LEFT rejoin row and labels the button Rejoin', () => {
    renderPreJoin({ ...preJoinStatus, participant: rejoinParticipant('LEFT') });
    const root = fixture.nativeElement as HTMLElement;

    expect(roomService.viewState()).toBe('preJoin');
    expect(root.querySelector('.prejoin__join')!.textContent).toContain('Rejoin');
  });

  it('shows initials while the preview is off and the blocked hint when the camera is denied', () => {
    renderPreJoin();
    const root = fixture.nativeElement as HTMLElement;

    const video = root.querySelector<HTMLVideoElement>('.prejoin__video')!;
    expect(video.classList).toContain('prejoin__video--hidden');
    expect(video.srcObject).toBeNull();
    expect(root.querySelector('.prejoin__avatar')).not.toBeNull();
    expect(root.querySelector('.prejoin__blocked')).toBeNull();

    devicesMock.cameraBlocked.set(true);
    fixture.detectChanges();
    expect(root.querySelector('.prejoin__blocked')).not.toBeNull();
  });

  it('binds the preview stream to the video element once one exists', () => {
    renderPreJoin();
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    devicesMock.previewStream.set(stream);
    fixture.detectChanges();

    const video = (fixture.nativeElement as HTMLElement).querySelector<HTMLVideoElement>('.prejoin__video')!;
    expect(video.srcObject).toBe(stream);
    expect(video.classList).not.toContain('prejoin__video--hidden');
    expect((fixture.nativeElement as HTMLElement).querySelector('.prejoin__avatar')).toBeNull();
  });

  it('round toggles flip the --off styling and delegate to the device service', () => {
    renderPreJoin();
    const root = fixture.nativeElement as HTMLElement;
    const [micButton, cameraButton] = root.querySelectorAll<HTMLButtonElement>('.prejoin__toggle');

    expect(cameraButton.classList).toContain('prejoin__toggle--off'); // gesture-first default
    micButton.click();
    expect(devicesMock.toggleMic).toHaveBeenCalledTimes(1);
    cameraButton.click();
    expect(devicesMock.toggleCamera).toHaveBeenCalledTimes(1);

    devicesMock.micEnabled.set(false);
    fixture.detectChanges();
    expect(micButton.classList).toContain('prejoin__toggle--off');
    expect(micButton.querySelector('i')!.classList).toContain('mic-off');
  });

  it('renders device dropdowns with labels, generic fallbacks, and routing', () => {
    renderPreJoin();
    devicesMock.mics.set([fakeDevice('audioinput', 'm1', 'USB Mic'), fakeDevice('audioinput', 'm2')]);
    devicesMock.cameras.set([fakeDevice('videoinput', 'c1', 'FaceTime HD')]);
    devicesMock.speakers.set([]);
    devicesMock.micDeviceId.set('m1');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const selects = root.querySelectorAll<HTMLSelectElement>('select.prejoin__select');
    expect(selects).toHaveLength(3);

    const micOptions = selects[0]!.querySelectorAll('option');
    expect(micOptions[0]!.textContent).toContain('USB Mic');
    expect(micOptions[0]!.selected).toBe(true);
    expect(micOptions[1]!.textContent).toContain('Microphone 2'); // label-less fallback

    expect(selects[2]!.textContent).toContain('No device found'); // @empty row

    selects[0]!.value = 'm2';
    selects[0]!.dispatchEvent(new Event('change'));
    expect(devicesMock.selectMic).toHaveBeenCalledWith('m2');

    selects[1]!.value = 'c1';
    selects[1]!.dispatchEvent(new Event('change'));
    expect(devicesMock.selectCamera).toHaveBeenCalledWith('c1');
  });

  it('joins on submit, disables while the POST is in flight, and surfaces its failure', () => {
    renderPreJoin();
    const root = fixture.nativeElement as HTMLElement;
    const joinButton = root.querySelector<HTMLButtonElement>('.prejoin__join')!;
    expect(joinButton.textContent).toContain('Join now');

    joinButton.click();
    const request = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/join`);
    fixture.detectChanges();
    expect(joinButton.disabled).toBe(true); // joining() while in flight

    request.flush('Server exploded', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(root.querySelector('.error-banner')).not.toBeNull();
  });

  it('copies the join code to the clipboard', () => {
    renderPreJoin();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.prejoin__code .table-button')!
      .click();

    expect(writeText).toHaveBeenCalledWith(CODE);
  });

  it('releases the device service on destroy', () => {
    renderPreJoin();
    fixture.destroy();
    expect(devicesMock.release).toHaveBeenCalled();
  });

  it('shows "No permission" and disables mic/camera selects while ungranted', () => {
    renderPreJoin();
    devicesMock.mics.set([fakeDevice('audioinput', 'm1', 'USB Mic')]);
    devicesMock.cameras.set([fakeDevice('videoinput', 'c1', 'FaceTime HD')]);
    devicesMock.micPermission.set('prompt'); // never asked
    devicesMock.cameraPermission.set('denied'); // explicitly refused
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const [micSelect, cameraSelect, speakerSelect] =
      root.querySelectorAll<HTMLSelectElement>('select.prejoin__select');

    expect(micSelect!.disabled).toBe(true);
    expect(micSelect!.options).toHaveLength(1);
    expect(micSelect!.options[0]!.textContent).toContain('No permission');

    expect(cameraSelect!.disabled).toBe(true);
    expect(cameraSelect!.options[0]!.textContent).toContain('No permission');

    expect(speakerSelect!.disabled).toBe(false); // speakers need no permission
  });

  it('lists devices once permission is granted (or unknowable)', () => {
    renderPreJoin();
    devicesMock.mics.set([fakeDevice('audioinput', 'm1', 'USB Mic')]);
    devicesMock.micPermission.set('granted');
    devicesMock.cameraPermission.set('unknown'); // no Permissions API — list anyway
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const [micSelect, cameraSelect] = root.querySelectorAll<HTMLSelectElement>(
      'select.prejoin__select',
    );

    expect(micSelect!.disabled).toBe(false);
    expect(micSelect!.options[0]!.textContent).toContain('USB Mic');
    expect(cameraSelect!.disabled).toBe(false);
  });
});
