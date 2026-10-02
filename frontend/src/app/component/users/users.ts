import { Component, OnInit, signal } from '@angular/core';
import { take } from 'rxjs';
import { UserService } from 'service/user.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import type { Role, UserWrapper } from 'model/user.model';
import { getApiErrorMessage } from 'util/api-util';
import { customFormattedDate } from 'util/time-util';
import { GlobalMessages } from 'component/shared/global-constants';

/** Roles an admin can assign here — ROLE_CUSTOMER is not assignable from the UI. */
const ASSIGNABLE_ROLES: Role[] = ['ROLE_USER', 'ROLE_ADMIN'];

/**
 * Admin user management — list, inline status/role controls and delete; no
 * create (signup owns that). UserWrapper.status is stringly 'true'/'false' on
 * the backend, and the timestamp field is createdTime.
 */
@Component({
  selector: 'app-users',
  imports: [],
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users implements OnInit {
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly rows = signal<UserWrapper[]>([]);

  protected readonly assignableRoles = ASSIGNABLE_ROLES;

  constructor(
    private userService: UserService,
    private modalService: ModalService,
    protected langService: LanguageService,
  ) {}

  // Formatting utils for the template
  protected readonly customFormattedDate = customFormattedDate;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.userService
      .getAll()
      .pipe(take(1))
      .subscribe({
        next: (users) => {
          this.rows.set(users);
          this.loading.set(false);
        },
        error: (error) => {
          this.errorMessage.set(getApiErrorMessage(error, GlobalMessages.genericError));
          this.loading.set(false);
        },
      });
  }

  toggleStatus(user: UserWrapper): void {
    const next = user.status === 'true' ? 'false' : 'true';
    this.userService
      .updateStatus(user.id, next)
      .pipe(take(1))
      .subscribe({
        next: () => this.load(),
        error: (error) => this.errorMessage.set(getApiErrorMessage(error, GlobalMessages.genericError)),
      });
  }

  onRoleChange(user: UserWrapper, event: Event): void {
    const role = (event.target as HTMLSelectElement).value as Role;
    if (role === user.role) {
      return;
    }
    this.userService
      .updateRole(user.id, role)
      .pipe(take(1))
      .subscribe({
        next: () => this.load(),
        error: (error) => this.errorMessage.set(getApiErrorMessage(error, GlobalMessages.genericError)),
      });
  }

  confirmDelete(user: UserWrapper): void {
    this.modalService.openConfirmation({
      title: 'Delete user',
      message: `Delete ${user.email} and all their data? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => this.deleteUser(user.id),
    });
  }

  private deleteUser(id: number): void {
    this.userService
      .delete(id)
      .pipe(take(1))
      .subscribe({
        next: () => this.load(),
        error: (error) => this.errorMessage.set(getApiErrorMessage(error, GlobalMessages.genericError)),
      });
  }
}
