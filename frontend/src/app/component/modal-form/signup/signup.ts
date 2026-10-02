import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { validateEmail, checkPasswordRequirements, validatePhone, validateName } from 'util/auth-util';
import { getApiErrorMessage } from 'util/api-util';
import { ModalService } from 'service/modal.service';
import { AuthService } from 'service/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoHideScrollbar],
  templateUrl: './signup.html',
  styleUrl: './signup.scss',
})
export class Signup {
  // Modal visibility
  isVisible = signal(false);
  hidePassword = true;
  hideConfirmPassword = true;

  constructor(
    private modalService: ModalService,
    private authService: AuthService,
    private router: Router,
  ) {
    effect(() => {
      if (this.modalService.isSignupVisible()) {
        this.isVisible.set(true);
      }
    });
  }

  // Form values
  email = signal('');
  name = signal('');
  phone = signal('');
  password = signal('');
  confirmPassword = signal('');

  // Validation states
  readonly isEmailValid = computed(() => validateEmail(this.email()));
  readonly isNameValid = computed(() => validateName(this.name()));
  readonly isPhoneValid = computed(() => validatePhone(this.phone()));
  readonly passwordRequirements = computed(() => checkPasswordRequirements(this.password()));
  readonly isPasswordValid = computed(() => this.passwordRequirements().allValid);
  readonly passwordsMatch = computed(() => this.password() === this.confirmPassword());

  // Form submission state
  readonly canSubmit = computed(
    () =>
      this.email() &&
      this.name() &&
      this.phone() &&
      this.password() &&
      this.confirmPassword() &&
      this.isEmailValid() &&
      this.isNameValid() &&
      this.isPhoneValid() &&
      this.isPasswordValid() &&
      this.passwordsMatch(),
  );
  readonly submitting = signal(false);
  readonly errorMessage = signal('');

  // Modal control methods
  show(): void {
    this.isVisible.set(true);
  }

  close(): void {
    this.isVisible.set(false);
    this.modalService.closeSignup();
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
      .signup({ name: this.name(), email: this.email(), phone: this.phone(), password: this.password() })
      .pipe(take(1))
      .subscribe({
        next: () => {
          // Signup auto-logs-in (the backend returns a token pair), so success is
          // equivalent to login success — same re-navigation for a possibly denied
          // initial route.
          this.router.navigateByUrl('/');
          this.close();
        },
        error: (error) => {
          this.submitting.set(false);
          this.errorMessage.set(getApiErrorMessage(error, 'Sign up failed. Please try again.'));
        },
      });
  }

  // Helper methods
  private resetForm(): void {
    this.email.set('');
    this.name.set('');
    this.phone.set('');
    this.password.set('');
    this.confirmPassword.set('');
    // Re-mask passwords so a reopened modal never shows them in plain text
    this.hidePassword = true;
    this.hideConfirmPassword = true;
    this.submitting.set(false);
    this.errorMessage.set('');
  }
}
