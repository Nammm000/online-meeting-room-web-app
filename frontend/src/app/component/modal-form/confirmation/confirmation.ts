import { Component, inject } from '@angular/core';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { ModalService } from 'service/modal.service';

/**
 * Shared confirmation dialog rendered straight off ModalService.confirmation()
 * — the request itself doubles as the visibility state. Cancel, backdrop and
 * Escape close without invoking; Confirm runs the callback then closes.
 */
@Component({
  selector: 'app-confirmation',
  imports: [AutoHideScrollbar],
  templateUrl: './confirmation.html',
  styleUrl: './confirmation.scss',
})
export class Confirmation {
  protected readonly modalService = inject(ModalService);

  confirm(): void {
    const request = this.modalService.confirmation();
    if (!request) {
      return;
    }
    this.modalService.closeConfirmation();
    request.onConfirm();
  }

  close(): void {
    this.modalService.closeConfirmation();
  }
}
