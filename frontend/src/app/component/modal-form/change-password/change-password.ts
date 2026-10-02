import { Component, computed, effect, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, NgForm } from "@angular/forms";
import { AutoHideScrollbar } from "directive/auto-hide-scrollbar";
import { take } from "rxjs";
import { checkPasswordRequirements } from "util/auth-util";
import { getApiErrorMessage } from "util/api-util";
import { ModalService } from "service/modal.service";
import { AuthService } from "service/auth.service";

@Component({
  selector: "app-change-password",
  standalone: true,
  imports: [CommonModule, FormsModule, AutoHideScrollbar],
  templateUrl: "./change-password.html",
  styleUrl: "./change-password.scss",
})
export class ChangePassword {
  // Modal visibility
  isVisible = signal(false);
  hideOldPassword = true;
  hideNewPassword = true;
  hideConfirmPassword = true;

  constructor(
    private modalService: ModalService,
    private authService: AuthService,
  ) {
    effect(() => {
      if (this.modalService.isChangePasswordVisible()) {
        this.isVisible.set(true);
      }
    });
  }

  // Form values
  oldPassword = signal("");
  newPassword = signal("");
  confirmPassword = signal("");

  // Validation states
  readonly passwordRequirements = computed(() =>
    checkPasswordRequirements(this.newPassword()),
  );
  readonly isPasswordValid = computed(
    () => this.passwordRequirements().allValid,
  );
  readonly passwordsMatch = computed(
    () => this.newPassword() === this.confirmPassword(),
  );

  // Form submission state
  readonly canSubmit = computed(
    () =>
      this.oldPassword() &&
      this.newPassword() &&
      this.confirmPassword() &&
      this.isPasswordValid() &&
      this.passwordsMatch(),
  );
  readonly submitting = signal(false);
  readonly errorMessage = signal("");

  // Modal control methods
  show(): void {
    this.isVisible.set(true);
  }

  close(): void {
    this.isVisible.set(false);
    this.modalService.closeChangePassword();
    this.resetForm();
  }

  // Form methods
  submit(_form: NgForm): void {
    if (!this.canSubmit() || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set("");
    // confirmPassword is a client-side check only — never sent to the backend.
    this.authService
      .changePassword({
        oldPassword: this.oldPassword(),
        newPassword: this.newPassword(),
      })
      .pipe(take(1))
      .subscribe({
        next: () => this.close(),
        error: (error) => {
          this.submitting.set(false);
          this.errorMessage.set(
            getApiErrorMessage(
              error,
              "Password change failed. Please try again.",
            ),
          );
        },
      });
  }

  // Helper methods
  private resetForm(): void {
    this.oldPassword.set("");
    this.newPassword.set("");
    this.confirmPassword.set("");
    this.submitting.set(false);
    this.errorMessage.set("");
  }
}
