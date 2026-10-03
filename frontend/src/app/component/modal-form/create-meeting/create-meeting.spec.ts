import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../environments/environment';
import { CreateMeeting } from './create-meeting';
import { ModalService } from 'service/modal.service';

const BASE_URL = `${environment.apiUrl}/meetings`;

const meetingFixture = (status: 'SCHEDULED' | 'IN_PROGRESS') => ({
  id: 1,
  joinCode: 'ABCDEFGHJK',
  title: 'Standup',
  description: null,
  type: status === 'IN_PROGRESS' ? 'INSTANT' : 'SCHEDULED',
  status,
  scheduledStartAt: null,
  scheduledEndAt: null,
  actualStartAt: null,
  endedAt: null,
  createdAt: '2026-10-02T08:00:00',
  waitingRoomEnabled: false,
  muteOnEntry: false,
  locked: false,
  hasPassword: false,
  hostId: 1,
  hostName: 'Alice',
  media: null,
});

describe('CreateMeeting', () => {
  let component: CreateMeeting;
  let fixture: ComponentFixture<CreateMeeting>;
  let httpMock: HttpTestingController;
  let modalService: ModalService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateMeeting],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateMeeting);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    modalService = TestBed.inject(ModalService);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  const submitButton = (): HTMLButtonElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.submit-button')!;

  const submit = (): void => {
    component.isVisible.set(true);
    fixture.detectChanges();
    component.submit();
  };

  it('blocks submit on a blank title', () => {
    expect(component.canSubmit()).toBe(false);

    component.title.set('   ');
    expect(component.canSubmit()).toBe(false);
  });

  it('blocks SCHEDULED submit until both timestamps exist and end is after start', () => {
    component.title.set('Retro');
    component.type.set('SCHEDULED');

    component.scheduledStartAt.set('2026-11-01T09:00');
    expect(component.canSubmit()).toBe(false);

    component.scheduledEndAt.set('2026-11-01T08:00');
    expect(component.canSubmit()).toBe(false);

    component.scheduledEndAt.set('2026-11-01T10:00');
    expect(component.canSubmit()).toBe(true);
  });

  it('submits an INSTANT meeting without any schedule payload', () => {
    component.isVisible.set(true);
    component.title.set('Standup');
    component.type.set('INSTANT');
    component.waitingRoomEnabled.set(true);
    submit();

    const request = httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);
    expect(request.request.body).toEqual({
      title: 'Standup',
      description: null,
      type: 'INSTANT',
      scheduledStartAt: null,
      scheduledEndAt: null,
      waitingRoomEnabled: true,
      muteOnEntry: false,
      password: null,
    });
    request.flush(meetingFixture('IN_PROGRESS'));
  });

  it('sends the trimmed password and null when left blank', () => {
    component.isVisible.set(true);
    component.title.set('Standup');
    component.password.set('  pw  ');
    submit();
    const withPassword = httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);
    expect(withPassword.request.body).toEqual(expect.objectContaining({ password: 'pw' }));
    withPassword.flush(meetingFixture('IN_PROGRESS'));

    // The first 201 closed and reset the form — start a second one blank.
    component.isVisible.set(true);
    component.title.set('Standup 2');
    submit();
    const withoutPassword = httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);
    expect(withoutPassword.request.body).toEqual(expect.objectContaining({ password: null }));
    withoutPassword.flush(meetingFixture('IN_PROGRESS'));
  });

  it('surfaces a 400 validation message from the backend', () => {
    component.isVisible.set(true);
    component.title.set('Standup');
    submit();
    const request = httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);
    request.flush({ status: 400, message: 'Title is required', timeStamp: 1 }, { status: 400, statusText: 'Bad Request' });

    expect(component.errorMessage()).toBe('Title is required');
    expect(component.isVisible()).toBe(true);
  });

  it('closes and notifies the opener on 201', () => {
    const created: unknown[] = [];
    modalService.openCreateMeeting((meeting) => created.push(meeting));

    component.title.set('Standup');
    submit();
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === BASE_URL)
      .flush(meetingFixture('IN_PROGRESS'));

    expect(created).toEqual([meetingFixture('IN_PROGRESS')]);
    expect(component.isVisible()).toBe(false);
    expect(modalService.isCreateMeetingVisible()).toBe(false);
  });

  it('opens itself when the modal service signal flips', () => {
    expect(component.isVisible()).toBe(false);
    modalService.openCreateMeeting();
    fixture.detectChanges();
    expect(component.isVisible()).toBe(true);
  });
});
