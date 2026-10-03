import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MessageResponse } from 'model/common.model';
import { PagedResponse } from 'model/paged-response.model';
import type {
  ChatMessage,
  SendChatRequestBody,
} from 'model/meeting.model';

/**
 * Persisted REST chat under /meetings/{joinCode}/chat. The backend sorts
 * newest-first (sentAt DESC, id DESC); the room store reverses pages for
 * ascending display. Readable by any past-or-present participant — including
 * after the meeting ends; sending requires JOINED + IN_PROGRESS.
 */
@Injectable({ providedIn: 'root' })
export class MeetingChatService {
  private readonly http = inject(HttpClient);

  private base(joinCode: string): string {
    return `${environment.apiUrl}/meetings/${joinCode}/chat`;
  }

  /** Paged history, newest first. */
  getMessages(
    joinCode: string,
    page: number,
    size: number,
  ): Observable<PagedResponse<ChatMessage>> {
    return this.http.get<PagedResponse<ChatMessage>>(this.base(joinCode), {
      params: { page, size },
    });
  }

  /** Sends a message; content is non-blank and at most 2000 characters. */
  send(joinCode: string, content: string): Observable<ChatMessage> {
    const body: SendChatRequestBody = { content };
    return this.http.post<ChatMessage>(this.base(joinCode), body);
  }

  /** Author or HOST; idempotent server-side. */
  delete(joinCode: string, messageId: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(
      `${this.base(joinCode)}/${messageId}`,
    );
  }
}
