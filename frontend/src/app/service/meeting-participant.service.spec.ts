import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { MeetingParticipantService } from 'service/meeting-participant.service';

const CODE = 'ABCDEFGHJK';
const BASE_URL = `${environment.apiUrl}/meetings/${CODE}`;

describe('MeetingParticipantService', () => {
  let httpMock: HttpTestingController;
  let service: MeetingParticipantService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MeetingParticipantService);
  });

  afterEach(() => httpMock.verify());

  const expectOne = (method: string, url: string) =>
    httpMock.expectOne((r) => r.method === method && r.url === url);

  it('joins and polls /me on the joinCode path', () => {
    service.join(CODE).subscribe();
    const join = expectOne('POST', `${BASE_URL}/join`);
    expect(join.request.body).toEqual({ password: null }); // open meeting
    join.flush({});

    service.join(CODE, 'pw').subscribe();
    const protectedJoin = expectOne('POST', `${BASE_URL}/join`);
    expect(protectedJoin.request.body).toEqual({ password: 'pw' });
    protectedJoin.flush({});

    service.me(CODE).subscribe();
    expectOne('GET', `${BASE_URL}/me`).flush({});
  });

  it('leaves and round-trips the misspelled message key', () => {
    const emitted: unknown[] = [];
    service.leave(CODE).subscribe((value) => emitted.push(value));

    expectOne('POST', `${BASE_URL}/leave`).flush({ messag: 'Left the meeting' });
    expect(emitted).toEqual([{ messag: 'Left the meeting' }]);
  });

  it('reads the lobby and roster lists', () => {
    service.getLobby(CODE).subscribe();
    expectOne('GET', `${BASE_URL}/lobby`).flush([]);

    service.getRoster(CODE).subscribe();
    expectOne('GET', `${BASE_URL}/roster`).flush([]);
  });

  it('admits and denies lobby members by user id', () => {
    service.admit(CODE, 7).subscribe();
    expectOne('POST', `${BASE_URL}/lobby/7/admit`).flush({ messag: 'Participant admitted' });

    service.deny(CODE, 7).subscribe();
    expectOne('POST', `${BASE_URL}/lobby/7/deny`).flush({ messag: 'Participant denied' });
  });

  it('distinguishes self-mute from moderator mute', () => {
    service.setSelfMute(CODE, true).subscribe();
    const self = expectOne('PATCH', `${BASE_URL}/participants/me/mute`);
    expect(self.request.body).toEqual({ muted: true });
    self.flush({ messag: 'Mute state updated' });

    service.muteParticipant(CODE, 7, false).subscribe();
    const other = expectOne('PATCH', `${BASE_URL}/participants/7/mute`);
    expect(other.request.body).toEqual({ muted: false });
    other.flush({ messag: 'Participant mute state updated' });
  });

  it('PATCHes the self speaking state', () => {
    service.setSelfSpeaking(CODE, true).subscribe();
    const request = expectOne('PATCH', `${BASE_URL}/participants/me/speaking`);
    expect(request.request.body).toEqual({ speaking: true });
    request.flush({ messag: 'Speaking state updated' });
  });

  it('PATCHes the self hand state and the moderator lower-hand', () => {
    service.setSelfHand(CODE, true).subscribe();
    const self = expectOne('PATCH', `${BASE_URL}/participants/me/hand`);
    expect(self.request.body).toEqual({ handRaised: true });
    self.flush({ messag: 'Hand state updated' });

    service.handParticipant(CODE, 7, false).subscribe();
    const other = expectOne('PATCH', `${BASE_URL}/participants/7/hand`);
    expect(other.request.body).toEqual({ handRaised: false });
    other.flush({ messag: 'Participant hand state updated' });
  });

  it('removes a participant', () => {
    service.removeParticipant(CODE, 7).subscribe();
    expectOne('DELETE', `${BASE_URL}/participants/7`).flush({ messag: 'Participant removed' });
  });

  it('locks with {locked} and changes roles with {role}', () => {
    service.setLocked(CODE, true).subscribe();
    const lock = expectOne('PATCH', `${BASE_URL}/lock`);
    expect(lock.request.body).toEqual({ locked: true });
    lock.flush({ messag: 'Meeting lock state updated' });

    service.setRole(CODE, 7, 'COHOST').subscribe();
    const role = expectOne('PATCH', `${BASE_URL}/participants/7/role`);
    expect(role.request.body).toEqual({ role: 'COHOST' });
    role.flush({ messag: 'Participant role updated' });
  });
});
