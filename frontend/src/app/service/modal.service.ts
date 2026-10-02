import { Injectable, signal } from '@angular/core';

/** A pending confirmation dialog. The request doubles as visibility state. */
export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string; // default 'Confirm'
  cancelLabel?: string; // default 'Cancel'
  danger?: boolean; // true → red confirm button (deletes)
  onConfirm: () => void;
}

@Injectable({ providedIn: 'root' })
export class ModalService {
  private loginVisible = signal(false);
  private signupVisible = signal(false);
  private changePasswordVisible = signal(false);
  private readonly _confirmation = signal<ConfirmationRequest | null>(null);

  // Signals for modals to read
  readonly isLoginVisible = this.loginVisible.asReadonly();
  readonly isSignupVisible = this.signupVisible.asReadonly();
  readonly isChangePasswordVisible = this.changePasswordVisible.asReadonly();
  readonly confirmation = this._confirmation.asReadonly();

  // Methods for header to call
  openLogin(): void {
    this.loginVisible.set(true);
  }

  openSignup(): void {
    this.signupVisible.set(true);
  }

  openChangePassword(): void {
    this.changePasswordVisible.set(true);
  }

  closeLogin(): void {
    this.loginVisible.set(false);
  }

  closeSignup(): void {
    this.signupVisible.set(false);
  }

  closeChangePassword(): void {
    this.changePasswordVisible.set(false);
  }

  // Shared confirmation dialog (delete flows on the asset pages)
  openConfirmation(request: ConfirmationRequest): void {
    this._confirmation.set({ confirmLabel: 'Confirm', cancelLabel: 'Cancel', ...request });
  }

  closeConfirmation(): void {
    this._confirmation.set(null);
  }
}
