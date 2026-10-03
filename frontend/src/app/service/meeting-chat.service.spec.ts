import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { MeetingChatService } from 'service/meeting-chat.service';

const CODE = 'ABCDEFGHJK';
const BASE_URL = `${environment.apiUrl}/meetings/${CODE}/chat`;

describe('MeetingChatService', () => {
  let httpMock: HttpTestingController;
  let service: MeetingChatService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MeetingChatService);
  });

  afterEach(() => httpMock.verify());

  const expectOne = (method: string, url: string) =>
    httpMock.expectOne((r) => r.method === method && r.url === url);

  it('loads paged history with page/size params', () => {
    service.getMessages(CODE, 0, 30).subscribe();

    const req = expectOne('GET', BASE_URL);
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('size')).toBe('30');
    req.flush({ content: [], page: 0, size: 30, totalElements: 0, totalPages: 0, first: true, last: true });
  });

  it('sends a broadcast with a null recipient, and a DM with the recipientUserId', () => {
    service.send(CODE, 'hello').subscribe();
    const broadcast = expectOne('POST', BASE_URL);
    expect(broadcast.request.body).toEqual({ content: 'hello', recipientUserId: null });
    broadcast.flush({ id: 1, content: 'hello' });

    service.send(CODE, 'psst', 7).subscribe();
    const private_ = expectOne('POST', BASE_URL);
    expect(private_.request.body).toEqual({ content: 'psst', recipientUserId: 7 });
    private_.flush({ id: 2, content: 'psst' });
  });

  it('deletes a message by its id', () => {
    service.delete(CODE, 12).subscribe();

    expectOne('DELETE', `${BASE_URL}/12`).flush({ messag: 'Message deleted' });
  });
});
