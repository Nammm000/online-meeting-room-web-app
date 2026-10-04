import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { AuthService } from 'service/auth.service';
import { MeetingRoomService } from 'service/meeting-room.service';
import { SpeechDetectionService } from 'service/speech-detection.service';
import { MeetingMediaService } from 'service/meeting-media.service';
import { StageAvatarService } from 'service/stage-avatar.service';
import { ModalService } from 'service/modal.service';
import type { JwtClaims } from 'util/jwt-util';
import type {
  ChatMessage,
  MediaCredentials,
  Meeting,
  MyMeetingStatus,
  Participant,
  ParticipantStatus,
} from 'model/meeting.model';
import type { PagedResponse } from 'model/paged-response.model';

const CODE = 'ABCDEFGHJK';
const BASE_URL = `${environment.apiUrl}/meetings/${CODE}`;

// ── fixtures ─────────────────────────────────────────────────────────────

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(claims: Partial<JwtClaims> = {}): string {
  const full: JwtClaims = {
    sub: 'host@test.com',
    role: 'ROLE_USER',
    iat: 1000,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `header.${base64Url(JSON.stringify(full))}.signature`;
}

const MEDIA: MediaCredentials = {
  liveKitUrl: 'http://localhost:7880',
  liveKitToken: 'tok',
  janusWsUrl: 'ws://localhost:8188',
  janusRoomId: 1,
  janusPin: 'pin',
  muted: false,
};

function participantFixture(
  status: ParticipantStatus,
  overrides: Partial<Participant> = {},
): Participant {
  return {
    userId: 2,
    name: 'Bob',
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
    ...overrides,
  };
}

function statusFixture(options: {
  participant: Participant | null;
  meetingStatus?: Meeting['status'];
  hasPassword?: boolean;
  media?: MediaCredentials | null;
  screenSharerId?: number | null;
}): MyMeetingStatus {
  return {
    meeting: {
      id: 1,
      joinCode: CODE,
      title: 'Standup',
      description: null,
      type: 'INSTANT',
      status: options.meetingStatus ?? 'IN_PROGRESS',
      scheduledStartAt: null,
      scheduledEndAt: null,
      actualStartAt: '2026-10-02T09:00:00',
      endedAt: null,
      createdAt: '2026-10-02T08:00:00',
      waitingRoomEnabled: true,
      muteOnEntry: false,
      locked: false,
      hasPassword: options.hasPassword ?? false,
      screenSharerUserId: options.screenSharerId ?? null,
      hostId: 1,
      hostName: 'Alice',
      media: null,
    },
    participant: options.participant,
    media: options.media ?? null,
  };
}

function chatPage(ids: number[], last = true): PagedResponse<ChatMessage> {
  return {
    content: ids.map((id) => ({
      id,
      senderId: 1,
      senderName: 'Alice',
      recipientId: null,
      recipientName: null,
      content: `m${id}`,
      sentAt: '2026-10-02T09:00:00',
    })),
    page: 0,
    size: 30,
    totalElements: ids.length,
    totalPages: 1,
    first: true,
    last,
  };
}

// ── harness ──────────────────────────────────────────────────────────────

let httpMock: HttpTestingController;
let service: MeetingRoomService;
let speechMock: ReturnType<typeof makeSpeechMock>;
let mediaMock: ReturnType<typeof makeMediaMock>;
let avatarMock: ReturnType<typeof makeAvatarMock>;

/** Pending requests matching a predicate (empty array when none). */
const pending = (method: string, path: string) =>
  httpMock.match((r) => r.method === method && r.url === `${BASE_URL}${path}`);

/** Flushes every pending /me poll with the given status. */
const flushMe = (status: MyMeetingStatus): number => {
  const requests = pending('GET', '/me');
  for (const request of requests) {
    request.flush(status);
  }
  return requests.length;
};

/** Flushes the one-shot history load that follows reaching a joined/ended state. */
const flushChat = (page: PagedResponse<ChatMessage> = chatPage([])): void => {
  const requests = pending('GET', '/chat');
  for (const request of requests) {
    request.flush(page);
  }
};

/** Flushes every pending roster fetch (the join-time fetch and/or a chain tick). */
const flushRoster = (roster: Participant[] = []): void => {
  for (const request of pending('GET', '/roster')) {
    request.flush(roster);
  }
};

const makeSpeechMock = () => ({
  speaking: signal(false),
  start: vi.fn(),
  stop: vi.fn(),
});

/** MeetingMediaService stand-in — every facade signal + method, inert. */
const makeMediaMock = () => ({
  connectionState: signal<'idle' | 'connecting' | 'connected' | 'failed'>('idle'),
  cameraPublishing: signal(false),
  screenSharing: signal(false),
  localCameraTrack: signal<unknown | null>(null),
  localScreenTrack: signal<unknown | null>(null),
  remoteCameraTracks: signal<ReadonlyMap<number, unknown>>(new Map()),
  screenShareTrack: signal<{ userId: number; track: unknown } | null>(null),
  offerCredentials: vi.fn(),
  disconnect: vi.fn(),
  setCameraEnabled: vi.fn(() => Promise.resolve()),
  setScreenShareEnabled: vi.fn(() => Promise.resolve()),
  subscribeTo: vi.fn(),
  unsubscribeFrom: vi.fn(),
});

const makeAvatarMock = () => ({
  urls: signal<ReadonlyMap<number, string>>(new Map()),
  urlFor: vi.fn((): string | null => null),
  ensureLoaded: vi.fn(),
  clearAll: vi.fn(),
});

/** flush(body) alone would be a 200 — errors need the status in the options. */
const flushError = (request: TestRequest, status: number, message: string): void => {
  request.flush({ status, message, timeStamp: 1759427449123 }, { status, statusText: message });
};

describe('MeetingRoomService', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    speechMock = makeSpeechMock();
    mediaMock = makeMediaMock();
    avatarMock = makeAvatarMock();
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SpeechDetectionService, useValue: speechMock },
        { provide: MeetingMediaService, useValue: mediaMock },
        { provide: StageAvatarService, useValue: avatarMock },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MeetingRoomService);
    // Live session, or the constructor's effect undoes start() immediately.
    TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken() });
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    httpMock.verify();
  });

  it('seeds viewState from the initial /me poll', () => {
    service.start(CODE);
    expect(service.viewState()).toBe('loading');

    flushMe(
      statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }),
    );
    flushRoster();
    flushChat();
    expect(service.viewState()).toBe('joined');
    expect(service.media()?.liveKitUrl).toBe('http://localhost:7880');
  });

  it('waits until media appears, then flips to joined', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('WAITING') }));
    expect(service.viewState()).toBe('waiting');

    vi.advanceTimersByTime(2000);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();
    expect(service.viewState()).toBe('joined');
  });

  it('polls /me every 2 seconds', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('WAITING') }));

    vi.advanceTimersByTime(2000);
    expect(flushMe(statusFixture({ participant: participantFixture('WAITING') }))).toBe(1);

    vi.advanceTimersByTime(1999);
    expect(pending('GET', '/me')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushMe(statusFixture({ participant: participantFixture('WAITING') }))).toBe(1);
  });

  it('maps participant states to their screens', () => {
    service.start(CODE);

    flushMe(statusFixture({ participant: null }));
    expect(service.viewState()).toBe('preJoin');

    vi.advanceTimersByTime(2000);
    flushMe(statusFixture({ participant: participantFixture('LEFT') }));
    expect(service.viewState()).toBe('preJoin');

    vi.advanceTimersByTime(2000);
    flushMe(statusFixture({ participant: participantFixture('REMOVED') }));
    expect(service.viewState()).toBe('removed');
  });

  it('stops polling on terminal meeting states and keeps chat data', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat(chatPage([1]));

    vi.advanceTimersByTime(2000);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), meetingStatus: 'ENDED' }));
    expect(service.viewState()).toBe('ended');

    vi.advanceTimersByTime(30_000);
    expect(pending('GET', '/me')).toHaveLength(0);
    expect(service.chatMessages().map((m) => m.id)).toEqual([1]);
  });

  it('stops on a 404 and reports not found', () => {
    service.start(CODE);
    flushError(pending('GET', '/me')[0]!, 404, 'Meeting not found');

    expect(service.viewState()).toBe('notFound');
    vi.advanceTimersByTime(30_000);
    expect(pending('GET', '/me')).toHaveLength(0);
  });

  it('backs off after a 429 and recovers on success', () => {
    service.start(CODE);
    flushError(pending('GET', '/me')[0]!, 429, 'Too many requests');

    // First backoff equals the base delay: retry at +2 s, failing again.
    vi.advanceTimersByTime(2000);
    flushError(pending('GET', '/me')[0]!, 429, 'Too many requests');

    // Second backoff doubles: nothing at +2 s, the retry lands at +4 s.
    vi.advanceTimersByTime(2000);
    expect(pending('GET', '/me')).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(flushMe(statusFixture({ participant: participantFixture('WAITING') }))).toBe(1);

    // Success restored the base cadence.
    vi.advanceTimersByTime(2000);
    expect(flushMe(statusFixture({ participant: participantFixture('WAITING') }))).toBe(1);
  });

  it('stop() silences every loop', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.stop();
    vi.advanceTimersByTime(60_000);
    expect(
      httpMock.match((r) => r.url?.startsWith(`${environment.apiUrl}/meetings`) ?? false),
    ).toHaveLength(0);
  });

  it('join() seats and restarts the loops after a removed halt', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('REMOVED') }));

    service.join();
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/join`)
      .flush(statusFixture({ participant: participantFixture('WAITING') }));
    expect(service.viewState()).toBe('waiting');

    // Loops re-armed: the next /me poll fires at +2 s.
    vi.advanceTimersByTime(2000);
    expect(flushMe(statusFixture({ participant: participantFixture('WAITING') }))).toBe(1);
  });

  it('leave() stops polling and runs the caller back', () => {
    let navigated = false;
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.leave(() => {
      navigated = true;
    });
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/leave`)
      .flush({ messag: 'Left the meeting' });

    expect(navigated).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(pending('GET', '/me')).toHaveLength(0);
  });

  it('admit fires the endpoint then refreshes the roster; lobby/chat reconcile on their chain', () => {
    service.start(CODE);
    const hostStatus = statusFixture({
      participant: participantFixture('JOINED', { userId: 1, name: 'Alice', role: 'HOST' }),
      media: MEDIA,
    });
    flushMe(hostStatus);
    flushRoster();
    flushChat();
    expect(service.canModerate()).toBe(true);

    service.admitUser(2);
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/lobby/2/admit`)
      .flush({ messag: 'Participant admitted' });

    // Row-action success refreshes the roster immediately; the moderator's
    // lobby + chat reconcile arrive on their own 5 s tick.
    vi.advanceTimersByTime(5000);
    flushMe(hostStatus);
    flushMe(hostStatus);
    flushRoster([participantFixture('JOINED')]);
    pending('GET', '/lobby')[0]!.flush([participantFixture('WAITING')]);
    flushChat(chatPage([5]));
    expect(service.actingUserId()).toBeNull();
    expect(service.roster()).toHaveLength(1);
    expect(service.lobby()).toHaveLength(1);
  });

  it('self-mute flips the local participant immediately', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.setSelfMuted(true);
    httpMock
      .expectOne((r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/mute`)
      .flush({ messag: 'Mute state updated' });

    expect(service.me()?.muted).toBe(true);
  });

  it('self hand toggle PATCHes and flips the local participant', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.setSelfHandRaised(true);
    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/hand`,
    );
    expect(req.request.body).toEqual({ handRaised: true });
    req.flush({ messag: 'Hand state updated' });

    expect(service.me()?.handRaised).toBe(true);
    expect(service.actingUserId()).toBeNull();
  });

  it('lowerHand fires the moderator endpoint then refreshes the roster', () => {
    service.start(CODE);
    const hostStatus = statusFixture({
      participant: participantFixture('JOINED', { userId: 1, name: 'Alice', role: 'HOST' }),
      media: MEDIA,
    });
    flushMe(hostStatus);
    flushRoster();
    flushChat();

    service.lowerHand(2);
    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/2/hand`,
    );
    expect(req.request.body).toEqual({ handRaised: false });
    req.flush({ messag: 'Participant hand state updated' });

    // Row-action success refreshes the roster (runRowAction), like admit.
    vi.advanceTimersByTime(2500);
    flushMe(hostStatus);
    flushMe(hostStatus);
    flushRoster([participantFixture('JOINED', { handRaised: false })]);
    flushChat();
    expect(service.actingUserId()).toBeNull();
  });

  // ── video + exclusive screen share ────────────────────────────────────────

  it('a taken share slot surfaces the exact server message and never captures', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.toggleSelfScreenShare();
    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/screen-share`,
    );
    expect(req.request.body).toEqual({ sharing: true });
    flushError(req, 409, 'You cannot share your screen while someone else is sharing.');

    expect(service.actionError()).toBe(
      'You cannot share your screen while someone else is sharing.',
    );
    expect(mediaMock.setScreenShareEnabled).not.toHaveBeenCalled();
    expect(service.actingUserId()).toBeNull();
  });

  it('a successful share claim starts the capture', async () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.toggleSelfScreenShare();
    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/screen-share`,
    );
    req.flush({ messag: 'Screen share state updated' });
    await vi.advanceTimersByTimeAsync(0); // settle the facade promise chain

    expect(mediaMock.setScreenShareEnabled).toHaveBeenCalledWith(true);
    expect(service.actingUserId()).toBeNull();
  });

  it('holding the slot with no live track releases it (native stop)', () => {
    service.start(CODE);
    flushMe(
      statusFixture({
        participant: participantFixture('JOINED'),
        media: MEDIA,
        screenSharerId: 2,
      }),
    );
    flushRoster();
    flushChat();
    mediaMock.connectionState.set('connected');
    mediaMock.screenSharing.set(false);
    TestBed.flushEffects();

    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/screen-share`,
    );
    expect(req.request.body).toEqual({ sharing: false });
    req.flush({ messag: 'Screen share state updated' });
    expect(service.actingUserId()).toBeNull();
  });

  it('host-forced camera off stops the local capture without a PATCH', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();
    mediaMock.cameraPublishing.set(true);
    TestBed.flushEffects();

    // The next /me poll (armed at +2 s) reports videoEnabled=false — the host
    // forced it off.
    vi.advanceTimersByTime(2000);
    flushMe(
      statusFixture({
        participant: participantFixture('JOINED', { videoEnabled: false }),
        media: MEDIA,
      }),
    );
    TestBed.flushEffects();

    expect(mediaMock.setCameraEnabled).toHaveBeenCalledWith(false);
    expect(
      httpMock.match((r) => r.method === 'PATCH' && r.url?.includes('/video')),
    ).toHaveLength(0);
  });

  it('moderator stop-share and camera-off PATCH their endpoints', () => {
    service.start(CODE);
    const hostStatus = statusFixture({
      participant: participantFixture('JOINED', { userId: 1, name: 'Alice', role: 'HOST' }),
      media: MEDIA,
      screenSharerId: 2,
    });
    flushMe(hostStatus);
    flushRoster();
    flushChat();

    service.stopParticipantShare(2);
    const share = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/2/screen-share`,
    );
    expect(share.request.body).toEqual({ sharing: false });
    share.flush({ messag: 'Participant screen share stopped' });
    flushRoster([participantFixture('JOINED')]);

    service.stopParticipantVideo(2);
    const video = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/2/video`,
    );
    expect(video.request.body).toEqual({ videoEnabled: false });
    video.flush({ messag: 'Participant video state updated' });
    flushRoster([participantFixture('JOINED', { videoEnabled: false })]);
    expect(service.actingUserId()).toBeNull();
  });

  it('toggleTileVideo subscribes on click and unsubscribes on the second click', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    const remote = participantFixture('JOINED', { userId: 3 });
    service.toggleTileVideo(remote); // no track yet → subscribe
    expect(mediaMock.subscribeTo).toHaveBeenCalledWith(3);

    mediaMock.remoteCameraTracks.set(new Map([[3, {}]]));
    service.toggleTileVideo(remote); // track live → hide
    expect(mediaMock.unsubscribeFrom).toHaveBeenCalledWith(3);

    service.toggleTileVideo(participantFixture('JOINED')); // self (userId 2) → no-op
    expect(mediaMock.subscribeTo).toHaveBeenCalledTimes(1);
    expect(mediaMock.unsubscribeFrom).toHaveBeenCalledTimes(1);
  });

  it('stop() disconnects the media facade and clears the avatar cache', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.stop();

    expect(mediaMock.disconnect).toHaveBeenCalled();
    expect(avatarMock.clearAll).toHaveBeenCalled();
  });

  it('surfaces a row-action failure via actionError', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.muteParticipant(3, true);
    flushError(
      httpMock.expectOne((r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/3/mute`),
      409,
      'Host cannot be muted',
    );

    expect(service.actionError()).toBe('Host cannot be muted');
    expect(service.actingUserId()).toBeNull();
  });

  it('reconciles chat: appends new messages and drops in-window deletions', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat(chatPage([3, 2, 1]));
    expect(service.chatMessages().map((m) => m.id)).toEqual([1, 2, 3]);

    // /me polls at +2 s/+4 s, the roster chain ticks at +2.5 s, and the
    // 5 s secondary chain reconciles chat (no lobby — not a moderator).
    vi.advanceTimersByTime(5000);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat(chatPage([4, 3, 1]));
    expect(service.chatMessages().map((m) => m.id)).toEqual([1, 3, 4]);
  });

  it('sendChat appends the 201 message without duplicating a reconciled copy', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat(chatPage([1]));

    service.sendChat('hello');
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/chat`)
      .flush({ id: 2, senderId: 2, senderName: 'Bob', recipientId: null, recipientName: null, content: 'hello', sentAt: '2026-10-02T09:01:00' });
    expect(service.chatMessages().map((m) => m.id)).toEqual([1, 2]);

    // A later reconcile delivering the same id must not duplicate it.
    vi.advanceTimersByTime(5000);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat(chatPage([2, 1]));
    expect(service.chatMessages().map((m) => m.id)).toEqual([1, 2]);
  });

  it('loadOlderChat prepends the next page in ascending order', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    const first = chatPage([4, 3], false);
    first.totalPages = 2;
    first.totalElements = 4;
    flushChat(first);
    expect(service.chatHasMore()).toBe(true);

    service.loadOlderChat();
    const older = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${BASE_URL}/chat` && r.params.get('page') === '1',
    );
    older.flush(chatPage([2, 1]));
    expect(service.chatMessages().map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(service.chatHasMore()).toBe(false);
  });

  it('endMeeting flips the local state to ended and halts the loops', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();

    service.endMeeting();
    httpMock
      .expectOne((r) => r.method === 'PATCH' && r.url === `${environment.apiUrl}/meetings/1/end`)
      .flush(statusFixture({ participant: participantFixture('JOINED'), meetingStatus: 'ENDED' }).meeting);

    expect(service.viewState()).toBe('ended');
    vi.advanceTimersByTime(30_000);
    expect(pending('GET', '/me')).toHaveLength(0);
  });

  // ── join password gate ───────────────────────────────────────────────────

  it('prompts for the password on a protected meeting and submits it with join', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('LEFT'), hasPassword: true }));
    expect(service.viewState()).toBe('preJoin');

    const modalService = TestBed.inject(ModalService);
    const openSpy = vi.spyOn(modalService, 'openJoinPassword');

    service.join();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(pending('POST', '/join')).toHaveLength(0); // nothing sent without the password

    modalService.joinPassword()?.onSubmit('pw');
    const join = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/join`);
    expect(join.request.body).toEqual({ password: 'pw' });
    join.flush(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();
    expect(service.viewState()).toBe('joined');
  });

  it('re-opens the password prompt with the server message on a join 403', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('LEFT'), hasPassword: true }));
    const openSpy = vi.spyOn(TestBed.inject(ModalService), 'openJoinPassword');

    service.join('wrong');
    flushError(
      httpMock.expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/join`),
      403,
      'Incorrect meeting password',
    );

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]![0].errorMessage).toBe('Incorrect meeting password');
    expect(service.actionError()).toBe(''); // not a generic failure — a re-prompt
  });

  it('exempts the host account from the join password', () => {
    service.start(CODE);
    flushMe(
      statusFixture({
        participant: participantFixture('LEFT', { userId: 1, name: 'Alice', role: 'HOST' }),
        hasPassword: true,
      }),
    );

    service.join();
    const join = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/join`);
    expect(join.request.body).toEqual({ password: null });
    join.flush(
      statusFixture({
        participant: participantFixture('JOINED', { userId: 1, name: 'Alice', role: 'HOST' }),
        media: MEDIA,
      }),
    );
    flushRoster();
    flushChat();
  });

  it('routes a non-403 join failure to actionError, not the prompt', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('LEFT') }));
    const openSpy = vi.spyOn(TestBed.inject(ModalService), 'openJoinPassword');

    service.join();
    flushError(
      httpMock.expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/join`),
      409,
      'Meeting is not IN_PROGRESS',
    );

    expect(openSpy).not.toHaveBeenCalled();
    expect(service.actionError()).toBe('Meeting is not IN_PROGRESS');
  });

  // ── stage ordering & speaking ────────────────────────────────────────────

  it('orders the stage: self first, speakers by recency adjacent, then the rest', () => {
    service.start(CODE);
    flushMe(
      statusFixture({
        participant: participantFixture('JOINED', { userId: 1, name: 'Alice' }),
        media: MEDIA,
      }),
    );
    flushRoster([
      participantFixture('JOINED', { userId: 1, name: 'Alice' }),
      participantFixture('JOINED', {
        userId: 2,
        name: 'Bob',
        speaking: true,
        lastSpeakingAt: '2026-10-02T09:00:02',
      }),
      participantFixture('JOINED', {
        userId: 3,
        name: 'Carol',
        speaking: true,
        lastSpeakingAt: '2026-10-02T09:00:05',
      }),
      participantFixture('JOINED', { userId: 4, name: 'Dan' }),
      participantFixture('JOINED', { userId: 5, name: 'Eve' }),
    ]);
    flushChat();

    expect(service.stageParticipants().map((p) => p.userId)).toEqual([1, 3, 2, 4, 5]);
  });

  it('keeps roster order for the stage when self is not on it yet', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster([participantFixture('JOINED', { userId: 3 }), participantFixture('JOINED', { userId: 4 })]);
    flushChat();

    expect(service.stageParticipants().map((p) => p.userId)).toEqual([3, 4]);
  });

  it('runs mic analysis while joined+unmuted and PATCHes speaking optimistically', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster();
    flushChat();
    TestBed.flushEffects();
    expect(speechMock.start).toHaveBeenCalled();
    speechMock.start.mockClear();
    speechMock.stop.mockClear();

    speechMock.speaking.set(true);
    TestBed.flushEffects();
    const patch = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/speaking`,
    );
    expect(patch.request.body).toEqual({ speaking: true });
    patch.flush({ messag: 'Speaking state updated' });
    expect(service.me()?.speaking).toBe(true); // optimistic self flip

    // Muting stops the analysis and clears the flag locally (server clamps too).
    service.setSelfMuted(true);
    httpMock
      .expectOne((r) => r.method === 'PATCH' && r.url === `${BASE_URL}/participants/me/mute`)
      .flush({ messag: 'Mute state updated' });
    TestBed.flushEffects();
    expect(speechMock.stop).toHaveBeenCalled();
    expect(service.me()?.speaking).toBe(false);
  });

  it('polls the roster every 2.5 s while the chat cycle stays at 5 s', () => {
    service.start(CODE);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA }));
    flushRoster(); // the join-time fetch
    flushChat(); // one-shot history load
    expect(pending('GET', '/roster')).toHaveLength(0);

    vi.advanceTimersByTime(2499);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA })); // /me at 2 s
    expect(pending('GET', '/roster')).toHaveLength(0);
    vi.advanceTimersByTime(1); // roster chain tick at 2.5 s
    // match() consumes — capture once, assert on it, flush from the capture.
    const tick = pending('GET', '/roster');
    expect(tick).toHaveLength(1);
    for (const request of tick) {
      request.flush([]);
    }

    vi.advanceTimersByTime(2499);
    flushMe(statusFixture({ participant: participantFixture('JOINED'), media: MEDIA })); // /me at 4 s
    expect(pending('GET', '/roster')).toHaveLength(0);
    expect(pending('GET', '/chat')).toHaveLength(0); // reconcile belongs to the 5 s chain
    vi.advanceTimersByTime(1); // 5 s: roster tick + chat reconcile together
    flushRoster(); // asserts nothing — but afterEach.verify proves exactly one fired
    flushChat();
  });
});
