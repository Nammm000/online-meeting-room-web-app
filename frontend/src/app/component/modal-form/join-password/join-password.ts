import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';

/**
 * Join-password prompt for password-protected meetings, rendered straight off
 * ModalService.joinPassword() — the ConfirmationRequest pattern, where the
 * request doubles as visibility state. The room service owns the join HTTP
 * call (and re-opens this prompt on its 403 with the server's message); the
 * modal just hands the entered password back. Cancel and backdrop close
 * without invoking.
 */
@Component({
  selector: 'app-join-password',
  imports: [FormsModule, AutoHideScrollbar],
  templateUrl: './join-password.html',
  styleUrl: './join-password.scss',
})
export class JoinPassword {
  protected readonly password = signal('');

  /** Mirrors the server's creation bounds (4-100) so 400s never surface. */
  protected readonly canSubmit = computed(() => {
    const length = this.password().trim().length;
    return length >= 4 && length <= 100;
  });

  constructor(
    protected modalService: ModalService,
    protected langService: LanguageService,
  ) {
    // A re-prompt (wrong password) must not show the rejected attempt.
    effect(() => {
      if (this.modalService.joinPassword() !== null) {
        this.password.set('');
      }
    });
  }

  submit(): void {
    const request = this.modalService.joinPassword();
    if (request === null || !this.canSubmit()) {
      return;
    }
    const entered = this.password().trim();
    this.close();
    request.onSubmit(entered);
  }

  close(): void {
    this.modalService.closeJoinPassword();
    this.password.set('');
  }
}
