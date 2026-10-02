import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { validateEmail } from 'util/auth-util';
import { getApiErrorMessage } from 'util/api-util';
import { ModalService } from 'service/modal.service';
import { AuthService } from 'service/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoHideScrollbar],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  // Modal visibility
  isVisible = signal(false);
  hide = true;

  constructor(
    private modalService: ModalService,
    private authService: AuthService,
    private router: Router,
  ) {
    effect(() => {
      if (this.modalService.isLoginVisible()) {
        this.isVisible.set(true);
      }
    });
  }

  // Form values
  email = signal('');
  password = signal('');

  // Validation states
  readonly isEmailValid = computed(() => validateEmail(this.email()));

  // Form submission state
  readonly canSubmit = computed(() => this.email() && this.password() && this.isEmailValid());
  readonly submitting = signal(false);
  readonly errorMessage = signal('');

  // Modal control methods
  show(): void {
    this.isVisible.set(true);
  }

  close(): void {
    this.isVisible.set(false);
    this.modalService.closeLogin();
    this.resetForm();
  }

  // Form methods
  submit(_form: NgForm): void {
    if (!this.canSubmit() || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set('');
    this.authService
      .login({ email: this.email(), password: this.password() })
      .pipe(take(1))
      .subscribe({
        next: () => {
          // A guard denial may have left the router with no active route —
          // re-navigate so the dashboard actually renders after login.
          this.router.navigateByUrl('/');
          this.close();
        },
        error: (error) => {
          this.submitting.set(false);
          this.errorMessage.set(getApiErrorMessage(error, 'Login failed. Please try again.'));
        },
      });
  }

  // Helper methods
  private resetForm(): void {
    this.email.set('');
    this.password.set('');
    // Re-mask the password so a reopened modal never shows it in plain text
    this.hide = true;
    this.submitting.set(false);
    this.errorMessage.set('');
  }
}
