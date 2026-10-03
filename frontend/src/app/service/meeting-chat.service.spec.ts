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

  it('sends a message with {content}', () => {
    service.send(CODE, 'hello').subscribe();

    const req = expectOne('POST', BASE_URL);
    expect(req.request.body).toEqual({ content: 'hello' });
    req.flush({ id: 1, content: 'hello' });
  });

  it('deletes a message by its id', () => {
    service.delete(CODE, 12).subscribe();

    expectOne('DELETE', `${BASE_URL}/12`).flush({ messag: 'Message deleted' });
  });
});
