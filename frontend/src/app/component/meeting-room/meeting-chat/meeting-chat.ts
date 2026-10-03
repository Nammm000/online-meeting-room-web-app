import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { MeetingRoomService } from 'service/meeting-room.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';

/**
 * Meeting chat panel. The store holds messages in ascending display order
 * (the backend pages newest-first); this component renders them, offers
 * "load older" prepends, sends on Enter/composer button and deletes (author
 * or host, behind the shared confirmation). Read-only whenever the caller
 * cannot send — after the meeting ended, or before joining — while the
 * history stays readable.
 */
@Component({
  selector: 'app-meeting-chat',
  imports: [FormsModule, AutoHideScrollbar],
  templateUrl: './meeting-chat.html',
  styleUrl: './meeting-chat.scss',
})
export class MeetingChat {
  protected readonly roomService = inject(MeetingRoomService);
  private readonly modalService = inject(ModalService);
  protected readonly langService = inject(LanguageService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly list = viewChild<ElementRef<HTMLElement>>('chatList');

  readonly draft = signal('');

  /** Private-message target; null = broadcast to everyone. */
  readonly recipientId = signal<number | null>(null);

  /** Joined participants besides me — the DM target list. */
  readonly recipientOptions = computed(() =>
    this.roomService.roster().filter(
      (participant) => participant.userId !== this.roomService.myUserId(),
    ),
  );

  readonly recipientName = computed(() => {
    const id = this.recipientId();
    if (id === null) {
      return null;
    }
    return (
      this.roomService.roster().find((participant) => participant.userId === id)?.name ?? null
    );
  });

  readonly canSubmit = computed(
    () => this.draft().trim() !== '' && this.roomService.canSendChat() && !this.roomService.chatSending(),
  );

  constructor() {
    // Stick to the bottom as messages arrive (browser only — no layout on SSR).
    effect(() => {
      this.roomService.chatMessages();
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }
      const element = this.list()?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  send(): void {
    if (!this.canSubmit()) {
      return;
    }
    // The selection survives a send — consecutive PMs to the same person are
    // the common case; the × clears back to broadcast.
    this.roomService.sendChat(this.draft(), this.recipientId());
    this.draft.set('');
  }

  onRecipientChange(value: number | null): void {
    this.recipientId.set(value);
  }

  clearRecipient(): void {
    this.recipientId.set(null);
  }

  loadOlder(): void {
    this.roomService.loadOlderChat();
  }

  canDelete(senderId: number): boolean {
    return this.roomService.isHost() || senderId === this.roomService.myUserId();
  }

  confirmDelete(messageId: number): void {
    this.modalService.openConfirmation({
      title: this.langService.t('meetingRoom.deleteMessageTitle'),
      message: this.langService.t('meetingRoom.deleteMessage'),
      confirmLabel: this.langService.t('meetingRoom.deleteConfirm'),
      danger: true,
      onConfirm: () => this.roomService.deleteChatMessage(messageId),
    });
  }
}
