import { Injectable, signal } from '@angular/core';
import type { Meeting } from 'model/meeting.model';

/** A pending confirmation dialog. The request doubles as visibility state. */
export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string; // default 'Confirm'
  cancelLabel?: string; // default 'Cancel'
  danger?: boolean; // true → red confirm button (deletes)
  onConfirm: () => void;
}

/**
 * A pending join-password prompt (the ConfirmationRequest pattern: the
 * request doubles as visibility state). The room service owns the HTTP —
 * the modal just hands the entered password back.
 */
export interface JoinPasswordRequest {
  meetingTitle?: string;
  /** Server message from a rejected attempt ("Incorrect meeting password"). */
  errorMessage?: string;
  onSubmit: (password: string) => void;
}

@Injectable({ providedIn: 'root' })
export class ModalService {
  private loginVisible = signal(false);
  private signupVisible = signal(false);
  private changePasswordVisible = signal(false);
  private createMeetingVisible = signal(false);
  private joinMeetingVisible = signal(false);
  private readonly _confirmation = signal<ConfirmationRequest | null>(null);
  private readonly _joinPassword = signal<JoinPasswordRequest | null>(null);

  // The create modal reports the 201 back to whoever opened it (the
  // ConfirmationRequest.onConfirm precedent — modals never navigate on their
  // own account, the opener decides what a new meeting means for the page).
  private createMeetingOnCreated: ((meeting: Meeting) => void) | null = null;

  // Signals for modals to read
  readonly isLoginVisible = this.loginVisible.asReadonly();
  readonly isSignupVisible = this.signupVisible.asReadonly();
  readonly isChangePasswordVisible = this.changePasswordVisible.asReadonly();
  readonly isCreateMeetingVisible = this.createMeetingVisible.asReadonly();
  readonly isJoinMeetingVisible = this.joinMeetingVisible.asReadonly();
  readonly confirmation = this._confirmation.asReadonly();
  readonly joinPassword = this._joinPassword.asReadonly();

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

  // Meetings toolbar modals (opened from the /meetings page)
  openCreateMeeting(onCreated?: (meeting: Meeting) => void): void {
    this.createMeetingOnCreated = onCreated ?? null;
    this.createMeetingVisible.set(true);
  }

  closeCreateMeeting(): void {
    this.createMeetingVisible.set(false);
    this.createMeetingOnCreated = null;
  }

  /** Runs the stored callback, if any — called by the modal on its 201. */
  notifyMeetingCreated(meeting: Meeting): void {
    const onCreated = this.createMeetingOnCreated;
    if (onCreated !== null) {
      onCreated(meeting);
    }
  }

  openJoinMeeting(): void {
    this.joinMeetingVisible.set(true);
  }

  closeJoinMeeting(): void {
    this.joinMeetingVisible.set(false);
  }

  // Shared confirmation dialog (delete flows on the asset pages)
  openConfirmation(request: ConfirmationRequest): void {
    this._confirmation.set({ confirmLabel: 'Confirm', cancelLabel: 'Cancel', ...request });
  }

  closeConfirmation(): void {
    this._confirmation.set(null);
  }

  // Join-password prompt (password-protected meetings; opened by MeetingRoomService)
  openJoinPassword(request: JoinPasswordRequest): void {
    this._joinPassword.set({ ...request });
  }

  closeJoinPassword(): void {
    this._joinPassword.set(null);
  }
}
