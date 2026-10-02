import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { Users } from './users';
import { ModalService } from 'service/modal.service';
import type { UserWrapper } from 'model/user.model';

const user = (id: number, status = 'true', role: UserWrapper['role'] = 'ROLE_USER'): UserWrapper => ({
  id,
  name: `User ${id}`,
  email: `user${id}@test.com`,
  phone: '0123456789',
  status,
  createdTime: '2026-01-01T10:00:00',
  role,
});

describe('Users', () => {
  let component: Users;
  let fixture: ComponentFixture<Users>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Users],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(Users);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  const flushList = (users: UserWrapper[]) =>
    httpMock.expectOne((r) => r.url === `${environment.apiUrl}/users`).flush(users);

  it('loads the plain (non-paged) list on init', () => {
    flushList([user(1), user(2)]);
    expect(component.rows()).toHaveLength(2);
    expect(component.loading()).toBe(false);
  });

  it('toggles status with the stringly-typed body', () => {
    flushList([user(1, 'true')]);

    component.toggleStatus(user(1, 'true'));
    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${environment.apiUrl}/users/1/status`,
    );
    expect(req.request.body).toEqual({ status: 'false' }); // stringly, not boolean
    req.flush({ messag: 'Updated' });
    flushList([user(1, 'false')]);

    expect(component.rows()[0].status).toBe('false');
  });

  it('changes role via the select handler', () => {
    flushList([user(1)]);

    const select = { value: 'ROLE_ADMIN' } as HTMLSelectElement;
    component.onRoleChange(user(1), { target: select } as unknown as Event);
    const req = httpMock.expectOne(
      (r) => r.method === 'PATCH' && r.url === `${environment.apiUrl}/users/1/role`,
    );
    expect(req.request.body).toEqual({ role: 'ROLE_ADMIN' });
    req.flush({ messag: 'Updated' });
    flushList([user(1, 'true', 'ROLE_ADMIN')]);

    expect(component.rows()[0].role).toBe('ROLE_ADMIN');
  });

  it('skips the PATCH when the selected role is unchanged', () => {
    flushList([user(1)]);

    const select = { value: 'ROLE_USER' } as HTMLSelectElement;
    component.onRoleChange(user(1), { target: select } as unknown as Event);

    httpMock.expectNone((r) => r.method === 'PATCH');
    expect(component.rows()[0].role).toBe('ROLE_USER');
  });

  it('deletes after confirmation and reloads', () => {
    flushList([user(1)]);

    component.confirmDelete(user(1));
    TestBed.inject(ModalService).confirmation()?.onConfirm();

    httpMock
      .expectOne((r) => r.method === 'DELETE' && r.url === `${environment.apiUrl}/users/1`)
      .flush({ messag: 'Deleted' });
    flushList([]);

    expect(component.rows()).toHaveLength(0);
  });
});
