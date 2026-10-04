import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MessageResponse } from 'model/common.model';
import type {
  HandRequestBody,
  JoinRequestBody,
  MeetingRoleUpdate,
  MuteRequestBody,
  MyMeetingStatus,
  Participant,
  SpeakingRequestBody,
} from 'model/meeting.model';

/**
 * Participation endpoints under /meetings/{joinCode} — every call addresses
 * the meeting by its external joinCode. Hosts never call join: creating an
 * INSTANT meeting (or starting a SCHEDULED one) already seats them JOINED.
 * Authorization is per-meeting participant role (HOST/COHOST/PARTICIPANT),
 * not the account role; the UI mirrors the gates to avoid predictable
 * 403/409s.
 */
@Injectable({ providedIn: 'root' })
export class MeetingParticipantService {
  private readonly http = inject(HttpClient);

  private base(joinCode: string): string {
    return `${environment.apiUrl}/meetings/${joinCode}`;
  }

  /**
   * Seats the caller; 409 unless the meeting is IN_PROGRESS and unlocked.
   * Password-protected meetings 403 without the correct password (the host
   * account is exempt) — 403, never 401: the interceptor owns auth-death 401s.
   */
  join(joinCode: string, password?: string | null): Observable<MyMeetingStatus> {
    const body: JoinRequestBody = { password: password ?? null };
    return this.http.post<MyMeetingStatus>(`${this.base(joinCode)}/join`, body);
  }

  /**
   * The polling channel: never mutates, returns the caller's meeting,
   * participant row (null if never touched) and — once JOINED while the
   * meeting is IN_PROGRESS — fresh media credentials.
   */
  me(joinCode: string): Observable<MyMeetingStatus> {
    return this.http.get<MyMeetingStatus>(`${this.base(joinCode)}/me`);
  }

  /** Ack body uses the backend-wide misspelled `messag` key. */
  leave(joinCode: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(joinCode)}/leave`, {});
  }

  /** WAITING rows. HOST/COHOST only. */
  getLobby(joinCode: string): Observable<Participant[]> {
    return this.http.get<Participant[]>(`${this.base(joinCode)}/lobby`);
  }

  admit(joinCode: string, userId: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      `${this.base(joinCode)}/lobby/${userId}/admit`,
      {},
    );
  }

  deny(joinCode: string, userId: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      `${this.base(joinCode)}/lobby/${userId}/deny`,
      {},
    );
  }

  /** JOINED rows. Caller must be JOINED or HOST/COHOST. */
  getRoster(joinCode: string): Observable<Participant[]> {
    return this.http.get<Participant[]>(`${this.base(joinCode)}/roster`);
  }

  /** Self audio mute; requires the caller to be JOINED. */
  setSelfMute(joinCode: string, muted: boolean): Observable<MessageResponse> {
    const body: MuteRequestBody = { muted };
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/participants/me/mute`,
      body,
    );
  }

  /** Self speaking state from local mic analysis; requires JOINED, clamped to false while muted. */
  setSelfSpeaking(
    joinCode: string,
    speaking: boolean,
  ): Observable<MessageResponse> {
    const body: SpeakingRequestBody = { speaking };
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/participants/me/speaking`,
      body,
    );
  }

  /** Self raised-hand toggle; requires JOINED. User-paced — no throttle needed. */
  setSelfHand(
    joinCode: string,
    handRaised: boolean,
  ): Observable<MessageResponse> {
    const body: HandRequestBody = { handRaised };
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/participants/me/hand`,
      body,
    );
  }

  /** Moderator mute; the host cannot be muted (409 server-side). */
  muteParticipant(
    joinCode: string,
    userId: number,
    muted: boolean,
  ): Observable<MessageResponse> {
    const body: MuteRequestBody = { muted };
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/participants/${userId}/mute`,
      body,
    );
  }

  /** Moderator lower-hand; the host row is 409 server-side. */
  handParticipant(
    joinCode: string,
    userId: number,
    handRaised: boolean,
  ): Observable<MessageResponse> {
    const body: HandRequestBody = { handRaised };
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/participants/${userId}/hand`,
      body,
    );
  }

  /** Moderator remove; host rows are rejected (409) and COHOST×COHOST is 403. */
  removeParticipant(
    joinCode: string,
    userId: number,
  ): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(
      `${this.base(joinCode)}/participants/${userId}`,
    );
  }

  /** Lock/unlock stops minting media tokens for newcomers. HOST only. */
  setLocked(joinCode: string, locked: boolean): Observable<MessageResponse> {
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/lock`,
      { locked },
    );
  }

  /** Promote/demote a co-host. HOST only; HOST targets are 409 server-side. */
  setRole(
    joinCode: string,
    userId: number,
    role: MeetingRoleUpdate,
  ): Observable<MessageResponse> {
    return this.http.patch<MessageResponse>(
      `${this.base(joinCode)}/participants/${userId}/role`,
      { role },
    );
  }
}
