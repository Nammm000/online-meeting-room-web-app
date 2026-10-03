import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from 'model/paged-response.model';
import type { CreateMeetingRequest, Meeting } from 'model/meeting.model';

/**
 * Meeting lifecycle on /meetings (JWT-protected). The split id rule matters:
 * create/get-by-code and the list work off the joinCode, but start/cancel/end
 * take the internal numeric id — the /my list rows are the only place the UI
 * reliably has it. `GET /meetings/my` returns only meetings the caller hosts.
 */
@Injectable({ providedIn: 'root' })
export class MeetingService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/meetings`;

  /**
   * Creates a meeting. An INSTANT one starts immediately (201 body carries the
   * host's media credentials); a SCHEDULED one returns media null until start.
   */
  create(request: CreateMeetingRequest): Observable<Meeting> {
    return this.http.post<Meeting>(this.baseUrl, request);
  }

  /** Paged meetings hosted by the caller, newest first. */
  getMyMeetings(page: number, size: number): Observable<PagedResponse<Meeting>> {
    return this.http.get<PagedResponse<Meeting>>(`${this.baseUrl}/my`, {
      params: { page, size },
    });
  }

  /** Meeting summary by joinCode (media null). 404 for an unknown code. */
  getByJoinCode(joinCode: string): Observable<Meeting> {
    return this.http.get<Meeting>(`${this.baseUrl}/${joinCode}`);
  }

  /** Starts a SCHEDULED meeting the caller hosts; the response carries host media. */
  start(id: number): Observable<Meeting> {
    return this.http.patch<Meeting>(`${this.baseUrl}/${id}/start`, {});
  }

  /** Cancels a SCHEDULED meeting the caller hosts. */
  cancel(id: number): Observable<Meeting> {
    return this.http.patch<Meeting>(`${this.baseUrl}/${id}/cancel`, {});
  }

  /** Ends an IN_PROGRESS meeting the caller hosts. */
  end(id: number): Observable<Meeting> {
    return this.http.patch<Meeting>(`${this.baseUrl}/${id}/end`, {});
  }
}
