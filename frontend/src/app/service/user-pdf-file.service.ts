import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MessageResponse } from 'model/common.model';
import { PagedResponse } from 'model/paged-response.model';
import { UserPdfFile } from 'model/user-pdf-file.model';

/**
 * Owns the signed-in user's PDF documents on /pdf-files (MinIO-backed, JWT
 * protected, current-user scoped). Uploads are one multipart request carrying
 * every file under the repeated `files` field — the backend caps it at 10
 * files / 20MB each, and a single request costs one rate-limit slot.
 * Downloads need the Authorization header, so they are fetched as Blobs and
 * handed to an <a download> by the page component (avatar precedent).
 */
@Injectable({ providedIn: 'root' })
export class UserPdfFileService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/pdf-files`;

  /** Uploads 1–10 PDFs in one request. Never set a Content-Type header — HttpClient derives it plus the multipart boundary. */
  upload(files: File[]): Observable<UserPdfFile[]> {
    const body = new FormData();
    for (const file of files) {
      body.append('files', file);
    }
    return this.http.post<UserPdfFile[]>(this.baseUrl, body);
  }

  /** Paged list of the current user's PDFs, newest first. */
  getAll(page: number, size: number): Observable<PagedResponse<UserPdfFile>> {
    return this.http.get<PagedResponse<UserPdfFile>>(this.baseUrl, {
      params: { page, size },
    });
  }

  /** Fetches the PDF bytes; the caller turns the Blob into a saved file. */
  download(id: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${id}`, { responseType: 'blob' });
  }

  delete(id: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.baseUrl}/${id}`);
  }
}
