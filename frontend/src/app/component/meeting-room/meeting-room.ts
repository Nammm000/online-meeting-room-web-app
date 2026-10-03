import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { MeetingRoomService } from 'service/meeting-room.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import { MeetingRoster } from 'component/meeting-room/meeting-roster/meeting-roster';
import { MeetingChat } from 'component/meeting-room/meeting-chat/meeting-chat';
import { meetingStatusLabel as statusLabel } from 'util/meeting-labels';

/**
 * The in-meeting view at /meetings/:joinCode/room. Owns no polling itself —
 * MeetingRoomService is started on init (joinCode from the route param) and
 * stopped on destroy, and the template just switches on its viewState:
 * pre-join, waiting room, the live room, removed, ended/cancelled (chat
 * stays readable) and not-found. Hosts/co-hosts get moderation controls,
 * everyone gets the media stage (WebRTC is a later milestone — audio/video
 * tiles are placeholders driven by the roster) and the connection info.
 */
@Component({
  selector: 'app-meeting-room',
  imports: [RouterLink, MeetingRoster, MeetingChat],
  templateUrl: './meeting-room.html',
  styleUrl: './meeting-room.scss',
})
export class MeetingRoom implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly roomService = inject(MeetingRoomService);
  private readonly modalService = inject(ModalService);
  protected readonly langService = inject(LanguageService);

  /** Connection-info disclosure (media credentials) — collapsed by default. */
  protected readonly showConnectionInfo = signal(false);

  protected readonly statusLabel = statusLabel;

  constructor() {
    this.destroyRef.onDestroy(() => this.roomService.stop());
  }

  ngOnInit(): void {
    const joinCode = this.route.snapshot.paramMap.get('joinCode');
    if (joinCode !== null && joinCode !== '') {
      this.roomService.start(joinCode.toUpperCase());
    }
  }

  /** Whether the pre-join button says "Rejoin" (previously LEFT/DECLINED). */
  protected isRejoin(): boolean {
    const status = this.roomService.me()?.status;
    return status === 'LEFT' || status === 'DECLINED';
  }

  protected join(): void {
    this.roomService.join();
  }

  protected toggleConnectionInfo(): void {
    this.showConnectionInfo.update((open) => !open);
  }

  protected toggleLock(): void {
    const locked = this.roomService.meeting()?.locked ?? false;
    this.roomService.setLocked(!locked);
  }

  protected confirmEndMeeting(): void {
    this.modalService.openConfirmation({
      title: this.langService.t('meetings.endTitle'),
      message: this.langService.t('meetings.endMessage'),
      confirmLabel: this.langService.t('meetings.endConfirm'),
      danger: true,
      onConfirm: () => this.roomService.endMeeting(),
    });
  }

  protected leave(): void {
    this.roomService.leave(() => this.router.navigate(['/meetings']));
  }

  protected toggleSelfMute(): void {
    this.roomService.setSelfMuted(!(this.roomService.me()?.muted ?? false));
  }

  protected copyJoinCode(): void {
    const code = this.roomService.meeting()?.joinCode;
    if (code) {
      navigator.clipboard?.writeText(code);
    }
  }

  /** Header avatar-fallback recipe: first letters of the first two words. */
  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('');
  }

  /** The LiveKit JWT is never shown in full — 24 characters is plenty to eyeball. */
  protected truncatedToken(token: string): string {
    return token.length <= 24 ? token : `${token.slice(0, 24)}…`;
  }
}
