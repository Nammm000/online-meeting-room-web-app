import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { MeetingService } from 'service/meeting.service';

const BASE_URL = `${environment.apiUrl}/meetings`;

describe('MeetingService', () => {
  let httpMock: HttpTestingController;
  let service: MeetingService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MeetingService);
  });

  afterEach(() => httpMock.verify());

  it('creates a meeting with the request body verbatim', () => {
    const request = {
      title: 'Standup',
      type: 'INSTANT' as const,
      waitingRoomEnabled: true,
    };
    const emitted: unknown[] = [];
    service.create(request).subscribe((value) => emitted.push(value));

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === BASE_URL);
    expect(req.request.body).toEqual(request);
    req.flush({ id: 1, joinCode: 'ABCDEFGHJK' });
    expect((emitted[0] as { joinCode: string }).joinCode).toBe('ABCDEFGHJK');
  });

  it('lists hosted meetings with page/size params', () => {
    service.getMyMeetings(1, 5).subscribe();

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/my`);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('size')).toBe('5');
    req.flush({ content: [], page: 1, size: 5, totalElements: 0, totalPages: 0, first: false, last: true });
  });

  it('fetches a meeting by its joinCode path segment', () => {
    service.getByJoinCode('ABCDEFGHJK').subscribe();

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${BASE_URL}/ABCDEFGHJK`)
      .flush({ id: 1, joinCode: 'ABCDEFGHJK' });
  });

  it('addresses lifecycle transitions by the numeric id, not the joinCode', () => {
    for (const [action, verb] of [
      ['start', 'start'],
      ['cancel', 'cancel'],
      ['end', 'end'],
    ] as const) {
      service[action](42).subscribe();
      httpMock
        .expectOne((r) => r.method === 'PATCH' && r.url === `${BASE_URL}/42/${verb}`)
        .flush({ id: 42 });
    }
  });
});
