import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Meetings } from './meetings';
import { ModalService } from 'service/modal.service';
import type { Meeting } from 'model/meeting.model';
import type { PagedResponse } from 'model/paged-response.model';

const BASE_URL = `${environment.apiUrl}/meetings`;

const row = (id: number, overrides: Partial<Meeting> = {}): Meeting => ({
  id,
  joinCode: `CODE00000${id}`,
  title: `Meeting ${id}`,
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
  ...overrides,
});

const paged = (content: Meeting[]): PagedResponse<Meeting> => ({
  content,
  page: 0,
  size: 10,
  totalElements: content.length,
  totalPages: 1,
  first: true,
  last: true,
});

@Component({ template: '' })
class DummyPage {}

describe('Meetings', () => {
  let component: Meetings;
  let fixture: ComponentFixture<Meetings>;
  let httpMock: HttpTestingController;
  let router: Router;
  let modalService: ModalService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Meetings],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: DummyPage }]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Meetings);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    modalService = TestBed.inject(ModalService);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  const flushList = (content: Meeting[] = []) =>
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/my`)
      .flush(paged(content));

  it('loads the hosted meetings on init', () => {
    expect(component.loading()).toBe(true);
    flushList([row(1)]);

    expect(component.loading()).toBe(false);
    expect(component.rows()).toHaveLength(1);
  });

  it('surfaces list errors through the error banner', () => {
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/my`)
      .flush({ status: 500, message: 'boom', timeStamp: 1 }, { status: 500, statusText: 'Server Error' });

    expect(component.errorMessage()).toBe('boom');
    expect(component.loading()).toBe(false);
  });

  it('navigates into the room by joinCode', () => {
    flushList();
    const navigate = vi.spyOn(router, 'navigate');

    const meeting = row(3);
    component.enterRoom(meeting);

    expect(navigate).toHaveBeenCalledWith(['/meetings', meeting.joinCode, 'room']);
  });

  it('starts a scheduled meeting and navigates into the room', () => {
    flushList();
    const navigate = vi.spyOn(router, 'navigate');
    const scheduled = row(4, { status: 'SCHEDULED', type: 'SCHEDULED', actualStartAt: null });

    component.start(scheduled);
    const request = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${BASE_URL}/4/start`,
    );
    expect(request.request.method).toBe('PATCH');
    request.flush(row(4, { status: 'IN_PROGRESS' }));

    expect(navigate).toHaveBeenCalledWith(['/meetings', scheduled.joinCode, 'room']);
  });

  it('cancels behind the confirmation modal, then reloads', () => {
    flushList();
    const scheduled = row(5, { status: 'SCHEDULED', type: 'SCHEDULED' });

    component.confirmCancel(scheduled);

    // Confirmation was requested with a danger flag; nothing fired yet.
    const request0 = modalService.confirmation();
    expect(request0?.danger).toBe(true);

    request0!.onConfirm();
    httpMock
      .expectOne((r) => r.method === 'PATCH' && r.url === `${BASE_URL}/5/cancel`)
      .flush(row(5, { status: 'CANCELLED' }));

    // The reload after cancel.
    flushList();
  });

  it('hands created meetings to the page callback: instant navigates, scheduled reloads', () => {
    flushList();
    component.openCreateModal();
    const navigate = vi.spyOn(router, 'navigate');

    // INSTANT: 201 with IN_PROGRESS → straight into the room.
    modalService.notifyMeetingCreated(row(6, { status: 'IN_PROGRESS' }));
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'CODE000006', 'room']);

    // SCHEDULED: reload of the list.
    modalService.notifyMeetingCreated(row(7, { status: 'SCHEDULED', type: 'SCHEDULED' }));
    flushList();
  });

  it('copies the join code to the clipboard', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    flushList();
    component.copyJoinCode(row(8));

    expect(writeText).toHaveBeenCalledWith('CODE000008');
    // The copy promise resolves on a microtask — flush before asserting.
    await vi.advanceTimersByTimeAsync(0);
    expect(component.copiedCode()).toBe('CODE000008');

    await vi.advanceTimersByTimeAsync(2100);
    expect(component.copiedCode()).toBe('');
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});
