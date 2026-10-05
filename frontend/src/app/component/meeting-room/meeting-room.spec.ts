import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { MeetingRoom } from './meeting-room';
import { MeetingRoomService } from 'service/meeting-room.service';
import { MeetingMediaService } from 'service/meeting-media.service';
import type { IncomingReaction } from 'service/meeting-media.service';
import { StageAvatarService } from 'service/stage-avatar.service';
import { AuthService } from 'service/auth.service';
import type { JwtClaims } from 'util/jwt-util';
import type { ChatMessage, MyMeetingStatus, Participant } from 'model/meeting.model';
import type { PagedResponse } from 'model/paged-response.model';

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

const participantRow = (userId: number, name: string): Participant => ({
  userId,
  name,
  email: 'bob@t.dev',
  role: 'PARTICIPANT',
  status: 'JOINED',
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

const joinedStatus: MyMeetingStatus = {
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
  participant: participantRow(2, 'Bob'),
  media: {
    liveKitUrl: 'http://localhost:7880',
    liveKitToken: 'tok',
    janusWsUrl: 'ws://localhost:8188',
    janusRoomId: 1,
    janusPin: 'pin',
    muted: false,
  },
};

const emptyChatPage: PagedResponse<ChatMessage> = {
  content: [],
  page: 0,
  size: 30,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
};

describe('MeetingRoom', () => {
  let component: MeetingRoom;
  let fixture: ComponentFixture<MeetingRoom>;
  let httpMock: HttpTestingController;
  let roomService: MeetingRoomService;
  let publishReaction: ReturnType<typeof vi.fn>;

  /** Inert media facade — the real one never connects under jsdom. */
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
    setCameraEnabled: vi.fn(() => Promise.resolve()),
    setScreenShareEnabled: vi.fn(() => Promise.resolve()),
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

  const pending = (method: string, path: string) =>
    httpMock.match((r) => r.method === method && r.url === `${BASE_URL}${path}`);

  /** Clicks the toolbar reactions button — the user's path to the picker. */
  const clickReactionsButton = (): void => {
    (document.querySelector('button[aria-haspopup="true"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  /** Satisfies whatever the polling loops scheduled (fake-timer jumps fire them). */
  const flushPolls = (): void => {
    for (const request of pending('GET', '/me')) {
      request.flush(joinedStatus);
    }
    for (const request of pending('GET', '/roster')) {
      request.flush([participantRow(2, 'Bob')]);
    }
    for (const request of pending('GET', '/chat')) {
      request.flush(emptyChatPage);
    }
  };

  /** Starts the room (no route param in this harness) and flushes the join burst. */
  const joinLive = (): void => {
    roomService.start(CODE);
    for (const request of pending('GET', '/me')) {
      request.flush(joinedStatus);
    }
    for (const request of pending('GET', '/roster')) {
      request.flush([participantRow(2, 'Bob')]);
    }
    for (const request of pending('GET', '/chat')) {
      request.flush(emptyChatPage);
    }
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    publishReaction = mediaFacadeMock.publishReaction as unknown as ReturnType<typeof vi.fn>;
    publishReaction.mockClear();
    await TestBed.configureTestingModule({
      imports: [MeetingRoom],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MeetingMediaService, useValue: mediaFacadeMock },
        { provide: StageAvatarService, useValue: stageAvatarMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingRoom);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    roomService = TestBed.inject(MeetingRoomService);
    // A live session, or the store's logout effect stops any started room.
    TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken() });
    joinLive();
    fixture.detectChanges();
    // Attached so document-level queries (and the picker's document:click
    // HostListener contract) see the real tree.
    document.body.appendChild(fixture.debugElement.nativeElement);
  });

  afterEach(() => {
    fixture.debugElement.nativeElement.remove();
    roomService.stop();
    vi.useRealTimers();
    httpMock.verify();
  });

  it('shows the reactions button with the picker closed', () => {
    const button = fixture.debugElement.nativeElement.querySelector(
      'button[aria-haspopup="true"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.reaction-picker')).toBeNull();
  });

  it('toggles the picker and renders the four emoji options', () => {
    clickReactionsButton();

    const options = Array.from(document.querySelectorAll('.reaction-picker__option'));
    expect(options.map((option) => option.textContent?.trim())).toEqual(['❤️', '😂', '😭', '👍']);
    expect(options[0]!.getAttribute('aria-label')).toBe('Heart');
    expect(options[3]!.getAttribute('aria-label')).toBe('Like');
  });

  it('selecting an emoji closes the picker and routes through sendReaction', () => {
    const spy = vi.spyOn(roomService, 'sendReaction');
    clickReactionsButton();

    (document.querySelector('.reaction-picker__option') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith('heart');
    expect(document.querySelector('.reaction-picker')).toBeNull();
    expect(publishReaction).toHaveBeenCalledWith('heart');
  });

  it('closes an open picker on outside click and on Escape', () => {
    clickReactionsButton();
    expect(document.querySelector('.reaction-picker')).not.toBeNull();

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(document.querySelector('.reaction-picker')).toBeNull();

    clickReactionsButton();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(document.querySelector('.reaction-picker')).toBeNull();
  });

  it('floats a reaction over the stage and clears it after the lifetime', () => {
    roomService.sendReaction('heart');
    fixture.detectChanges();

    const floats = Array.from(document.querySelectorAll('.stage-reactions__float'));
    expect(floats).toHaveLength(1);
    expect(floats[0]!.querySelector('.stage-reactions__emoji')?.textContent?.trim()).toBe('❤️');
    expect(floats[0]!.querySelector('.stage-reactions__name')?.textContent?.trim()).toBe('Bob');

    vi.advanceTimersByTime(3200);
    flushPolls(); // the jump also fired the /me and roster polling ticks
    fixture.detectChanges();
    expect(document.querySelector('.stage-reactions__float')).toBeNull();
  });

  it('floats remote feed reactions without touching publishReaction', () => {
    mediaFacadeMock.reactionFeed.set([{ seq: 1, userId: 2, reaction: 'laugh' }]);
    TestBed.flushEffects();
    fixture.detectChanges();

    const floats = Array.from(document.querySelectorAll('.stage-reactions__emoji'));
    expect(floats.map((float) => float.textContent?.trim())).toEqual(['😂']);
    expect(publishReaction).not.toHaveBeenCalled();
  });
});
