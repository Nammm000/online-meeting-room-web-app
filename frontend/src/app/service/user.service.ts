import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MessageResponse } from 'model/common.model';
import type { Role, UserWrapper, UpdateUserRoleRequest } from 'model/user.model';

/** /users endpoints — ADMIN-only on the backend, except `getCurrentUser` (any JWT). */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/users`;

  getAll(): Observable<UserWrapper[]> {
    return this.http.get<UserWrapper[]>(this.baseUrl);
  }

  getCurrentUser(): Observable<UserWrapper> {
    return this.http.get<UserWrapper>(`${this.baseUrl}/current-user`);
  }

  updateStatus(id: number, status: string): Observable<MessageResponse> {
    return this.http.patch<MessageResponse>(`${this.baseUrl}/${id}/status`, { status });
  }

  updateRole(id: number, role: Role): Observable<MessageResponse> {
    const body: UpdateUserRoleRequest = { role };
    return this.http.patch<MessageResponse>(`${this.baseUrl}/${id}/role`, body);
  }

  delete(id: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.baseUrl}/${id}`);
  }
}
