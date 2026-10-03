import { TestBed } from "@angular/core/testing";
import { PLATFORM_ID } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { environment } from "../../environments/environment";
import { AuthService } from "service/auth.service";
import { ModalService } from "service/modal.service";
import { NotificationService } from "service/notification.service";
import type { JwtClaims } from "util/jwt-util";

// jsdom has no WebSocket — the service must be exercised against a fake that
// records every constructed instance (its URL) and lets the spec fire the
// socket callbacks by hand.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
}

function fireOpen(ws: FakeWebSocket): void {
  ws.onopen?.(null as unknown as Event);
}

function fireMessage(ws: FakeWebSocket, data: string): void {
  ws.onmessage?.({ data } as unknown as MessageEvent);
}

function fireClose(ws: FakeWebSocket): void {
  ws.onclose?.(null as unknown as CloseEvent);
}

/** Drains the promise chain of an async reconnect() triggered by a timer. */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeToken(claims: Partial<JwtClaims> = {}): string {
  const full: JwtClaims = {
    sub: "user@test.com",
    role: "ROLE_USER",
    iat: 1000,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `ws.${base64Url(JSON.stringify(full))}.signature`;
}

const VALID_FRAME = JSON.stringify({
  message: "Reminder: review your assets.",
  timestamp: "2026-09-12T08:30:00Z",
});

describe("NotificationService", () => {
  let httpMock: HttpTestingController;
  let authService: AuthService;

  beforeEach(async () => {
    FakeWebSocket.instances = [];
    // The service persists the bell to localStorage and restores it in its
    // constructor — without this, one test's bell leaks into the next.
    localStorage.removeItem("asset-manager.notifications");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    httpMock.verify();
  });

  it("does not connect until a session is active, then connects with the token", () => {
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    expect(FakeWebSocket.instances).toHaveLength(0);

    const token = makeToken();
    authService.applyAuthenticationResponse({ accessToken: token });
    TestBed.flushEffects();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe(
      `ws://localhost:8083/ws/notifications?token=${token}`,
    );
  });

  it("tracks connection state", () => {
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    expect(service.connected()).toBe(false);

    fireOpen(FakeWebSocket.instances[0]);
    expect(service.connected()).toBe(true);
  });

  it("stores valid frames newest-first and bumps the unread count", () => {
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    const ws = FakeWebSocket.instances[0];

    fireMessage(ws, VALID_FRAME);
    fireMessage(
      ws,
      JSON.stringify({ message: "Second", timestamp: "2026-09-12T09:00:00Z" }),
    );

    expect(service.notifications()).toHaveLength(2);
    expect(service.notifications()[0].message).toBe("Second");
    expect(service.unreadCount()).toBe(2);
  });

  it("ignores malformed frames and wrong shapes without touching state", () => {
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    const ws = FakeWebSocket.instances[0];

    fireMessage(ws, "{not json");
    fireMessage(ws, JSON.stringify({ message: "no timestamp" }));
    fireMessage(
      ws,
      JSON.stringify({ message: "bad date", timestamp: "not-a-date" }),
    );
    fireMessage(ws, JSON.stringify({ timestamp: "2026-09-12T09:00:00Z" }));

    expect(service.notifications()).toHaveLength(0);
    expect(service.unreadCount()).toBe(0);
  });

  it("caps history and unread count at 20", () => {
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    const ws = FakeWebSocket.instances[0];

    for (let i = 0; i < 25; i++) {
      fireMessage(
        ws,
        JSON.stringify({ message: `m${i}`, timestamp: "2026-09-12T09:00:00Z" }),
      );
    }

    expect(service.notifications()).toHaveLength(20);
    // Oldest five evicted; newest first.
    expect(service.notifications()[0].message).toBe("m24");
    expect(service.notifications()[19].message).toBe("m5");
    expect(service.unreadCount()).toBe(20);
  });

  it("markAllRead clears the badge; clearAll empties everything", () => {
    authService.applyAuthenticationResponse({ accessToken: makeToken() });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    fireMessage(FakeWebSocket.instances[0], VALID_FRAME);

    service.markAllRead();
    expect(service.unreadCount()).toBe(0);
    expect(service.notifications()).toHaveLength(1);

    service.clearAll();
    expect(service.notifications()).toHaveLength(0);
    expect(service.unreadCount()).toBe(0);
  });

  it("reconnects with backoff after an unexpected close while the session is live", () => {
    vi.useFakeTimers();
    try {
      const token = makeToken();
      authService.applyAuthenticationResponse({ accessToken: token });
      const service = TestBed.inject(NotificationService);
      TestBed.flushEffects();
      const first = FakeWebSocket.instances[0];

      fireOpen(first);
      fireClose(first);
      expect(service.connected()).toBe(false);

      vi.advanceTimersByTime(999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.instances[1].url).toBe(
        `ws://localhost:8083/ws/notifications?token=${token}`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes an expired token before reconnecting and signs the new socket with it", async () => {
    vi.useFakeTimers();
    try {
      const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
      authService.applyAuthenticationResponse({ accessToken: expired });
      const service = TestBed.inject(NotificationService);
      TestBed.flushEffects();
      fireClose(FakeWebSocket.instances[0]);

      vi.advanceTimersByTime(1000);
      await drainMicrotasks();

      // The 15-min token died while the socket was down: refresh first.
      const refresh = httpMock.expectOne(
        (req) => req.url === `${environment.apiUrl}/auth/refresh`,
      );
      expect(refresh.request.withCredentials).toBe(true);
      const fresh = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      refresh.flush({ accessToken: fresh });
      await drainMicrotasks();

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.instances[1].url).toBe(
        `ws://localhost:8083/ws/notifications?token=${fresh}`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands a failed refresh to sessionExpired() instead of reconnecting", async () => {
    vi.useFakeTimers();
    try {
      const openLoginSpy = vi.spyOn(TestBed.inject(ModalService), "openLogin");
      const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
      authService.applyAuthenticationResponse({ accessToken: expired });
      const service = TestBed.inject(NotificationService);
      TestBed.flushEffects();
      fireClose(FakeWebSocket.instances[0]);

      vi.advanceTimersByTime(1000);
      await drainMicrotasks();

      httpMock
        .expectOne((req) => req.url === `${environment.apiUrl}/auth/refresh`)
        .flush(
          { status: 401, message: "nope", timeStamp: Date.now() },
          { status: 401, statusText: "Unauthorized" },
        );
      await drainMicrotasks();

      expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect
      expect(authService.sessionActive()).toBe(false);
      expect(openLoginSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logout closes the socket and resets the bell for the next session", () => {
    const token = makeToken();
    authService.applyAuthenticationResponse({ accessToken: token });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();
    const ws = FakeWebSocket.instances[0];
    fireMessage(ws, VALID_FRAME);
    expect(service.unreadCount()).toBe(1);

    authService.logout(); // live token: fires the logout POST, clears synchronously
    httpMock
      .expectOne((req) => req.url === `${environment.apiUrl}/auth/logout`)
      .flush({ message: "Bye" });
    TestBed.flushEffects(); // effect sees sessionActive=false -> disconnect(true)

    expect(ws.close).toHaveBeenCalled();
    expect(service.connected()).toBe(false);
    expect(service.notifications()).toHaveLength(0);
    expect(service.unreadCount()).toBe(0);
  });
});

describe("NotificationService (SSR)", () => {
  beforeEach(async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    await TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "server" },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never opens a socket on the server platform, even with a session", () => {
    TestBed.inject(AuthService).applyAuthenticationResponse({
      accessToken: makeToken(),
    });
    const service = TestBed.inject(NotificationService);
    TestBed.flushEffects();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(service.notifications()).toHaveLength(0);
  });
});
