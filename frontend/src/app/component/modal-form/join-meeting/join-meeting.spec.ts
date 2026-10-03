import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { JoinMeeting } from './join-meeting';
import { ModalService } from 'service/modal.service';

const CODE = 'ABCDEFGHJK';
const BASE_URL = `${environment.apiUrl}/meetings/${CODE}`;

const meetingFixture = {
  id: 1,
  joinCode: CODE,
  title: 'Standup',
  description: null,
  type: 'INSTANT',
  status: 'IN_PROGRESS',
  scheduledStartAt: null,
  scheduledEndAt: null,
  actualStartAt: null,
  endedAt: null,
  createdAt: '2026-10-02T08:00:00',
  waitingRoomEnabled: true,
  muteOnEntry: false,
  locked: false,
  hasPassword: false,
  hostId: 1,
  hostName: 'Alice',
  media: null,
};

@Component({ template: '' })
class DummyPage {}

describe('JoinMeeting', () => {
  let component: JoinMeeting;
  let fixture: ComponentFixture<JoinMeeting>;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JoinMeeting],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: DummyPage }]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JoinMeeting);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it('normalizes the pasted code before looking it up', () => {
    component.code.set(' abcdefghjk ');
    expect(component.normalizedCode()).toBe(CODE);
  });

  it('refuses to search for an empty code', () => {
    component.code.set('   ');
    expect(component.canFind()).toBe(false);
  });

  it('shows the preview card for a found meeting', () => {
    component.isVisible.set(true);
    component.code.set(CODE);
    fixture.detectChanges();

    component.find();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === BASE_URL)
      .flush(meetingFixture);
    fixture.detectChanges();

    expect(component.found()?.title).toBe('Standup');
    expect(component.findError()).toBe('');
  });

  it('keeps the modal open with the 404 message for an unknown code', () => {
    component.isVisible.set(true);
    component.code.set(CODE);
    component.find();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === BASE_URL)
      .flush({ status: 404, message: 'Meeting not found', timeStamp: 1 }, { status: 404, statusText: 'Not Found' });

    expect(component.found()).toBeNull();
    expect(component.findError()).toBe('Meeting not found');
  });

  it('navigates into the room on Enter room and closes itself', async () => {
    const navigate = vi.spyOn(router, 'navigate');

    component.isVisible.set(true);
    component.code.set(CODE);
    component.find();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === BASE_URL)
      .flush(meetingFixture);

    component.enterRoom();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/meetings', CODE, 'room']);
    expect(component.isVisible()).toBe(false);
    expect(TestBed.inject(ModalService).isJoinMeetingVisible()).toBe(false);
  });
});
