import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { MeetingChat } from './meeting-chat';
import { MeetingRoomService } from 'service/meeting-room.service';
import { AuthService } from 'service/auth.service';
import { ModalService } from 'service/modal.service';
import type { JwtClaims } from 'util/jwt-util';
import type { ChatMessage, MyMeetingStatus } from 'model/meeting.model';
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

const message = (id: number, senderId = 1): ChatMessage => ({
  id,
  senderId,
  senderName: 'Alice',
  content: `m${id}`,
  sentAt: '2026-10-02T09:00:00',
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
    hostId: 1,
    hostName: 'Alice',
    media: null,
  },
  participant: {
    userId: 2,
    name: 'Bob',
    role: 'PARTICIPANT',
    status: 'JOINED',
    muted: false,
    joinCount: 1,
    firstJoinedAt: null,
    lastJoinedAt: null,
    lastLeftAt: null,
    admittedByName: null,
  },
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

describe('MeetingChat', () => {
  let component: MeetingChat;
  let fixture: ComponentFixture<MeetingChat>;
  let httpMock: HttpTestingController;
  let roomService: MeetingRoomService;
  let modalService: ModalService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeetingChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingChat);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    roomService = TestBed.inject(MeetingRoomService);
    modalService = TestBed.inject(ModalService);
    // A live session, or the store's logout effect stops any started room.
    TestBed.inject(AuthService).applyAuthenticationResponse({ accessToken: makeToken() });
    await fixture.whenStable();
  });

  afterEach(() => {
    roomService.stop();
    httpMock.verify();
  });

  /** Opens a joined room and satisfies the initial /me + history load. */
  const openJoinedRoom = (history: PagedResponse<ChatMessage> = emptyChatPage) => {
    roomService.start(CODE);
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/me`)
      .flush(joinedStatus);
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/chat`)
      .flush(history);
  };

  it('renders the store messages with self-highlighting for own messages', () => {
    openJoinedRoom({
      ...emptyChatPage,
      content: [message(2, 2), message(1, 1)],
      totalElements: 2,
      totalPages: 1,
    });
    fixture.detectChanges();

    const items = (fixture.nativeElement as HTMLElement).querySelectorAll('.chat-list__item');
    expect(items).toHaveLength(2);
    // Ascending: id 1 first, own message (sender 2 = myUserId) last.
    expect(items[0]!.classList).not.toContain('chat-list__item--self');
    expect(items[1]!.classList).toContain('chat-list__item--self');
  });

  it('shows the read-only note when the room is not joined', () => {
    // No room at all: the composer is hidden, the read-only note shows.
    fixture.detectChanges();
    const note = (fixture.nativeElement as HTMLElement).querySelector('.chat-readonly');
    expect(note).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.chat-composer')).toBeNull();
  });

  it('sends the trimmed draft and clears it on success', () => {
    openJoinedRoom();
    fixture.detectChanges();

    component.draft.set('  hello  ');
    component.send();
    const request = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${BASE_URL}/chat`);
    expect(request.request.body).toEqual({ content: 'hello' });
    request.flush(message(3, 2));

    expect(component.draft()).toBe('');
    expect(roomService.chatMessages().map((m) => m.id)).toEqual([3]);
  });

  it('deletes behind the confirmation modal', () => {
    const openConfirmation = vi.spyOn(modalService, 'openConfirmation');

    component.confirmDelete(7);

    expect(openConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ danger: true, onConfirm: expect.any(Function) }),
    );
  });
});
