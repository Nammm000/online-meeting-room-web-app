import { Component, DestroyRef, ElementRef, HostListener, OnInit, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { MeetingRoomService } from 'service/meeting-room.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import { StageAvatarService } from 'service/stage-avatar.service';
import { MeetingRoster } from 'component/meeting-room/meeting-roster/meeting-roster';
import { MeetingChat } from 'component/meeting-room/meeting-chat/meeting-chat';
import { MeetingPrejoin } from 'component/meeting-room/meeting-prejoin/meeting-prejoin';
import { VideoTrackDirective } from 'directive/video-track';
import { meetingStatusLabel as statusLabel } from 'util/meeting-labels';
import { participantRoleLabel as roleLabel } from 'util/meeting-labels';
import { REACTIONS } from 'service/meeting-media.service';
import type { ReactionKey, VideoTrack } from 'service/meeting-media.service';
import type { TranslationKey } from 'i18n/translations';
import type { Participant } from 'model/meeting.model';

/**
 * The in-meeting view at /meetings/:joinCode/room. Owns no polling itself —
 * MeetingRoomService is started on init (joinCode from the route param) and
 * stopped on destroy, and the template just switches on its viewState:
 * pre-join (delegated to MeetingPrejoin — camera preview, device pickers,
 * join), waiting room, the live room, removed, ended/cancelled (chat stays
 * readable) and not-found. Hosts/co-hosts get moderation controls, everyone
 * gets the media stage and the connection info.
 */
@Component({
  selector: 'app-meeting-room',
  imports: [RouterLink, MeetingRoster, MeetingChat, MeetingPrejoin, VideoTrackDirective],
  templateUrl: './meeting-room.html',
  styleUrl: './meeting-room.scss',
})
export class MeetingRoom implements OnInit {
  /** Horizontal float lanes — deterministic stagger by stream position. */
  private static readonly REACTION_LANES = ['10%', '30%', '50%', '70%', '90%'] as const;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject(ElementRef);

  protected readonly roomService = inject(MeetingRoomService);
  private readonly modalService = inject(ModalService);
  protected readonly langService = inject(LanguageService);
  protected readonly stageAvatar = inject(StageAvatarService);

  /** Avatar URLs that failed to load — falls those tiles back to initials. */
  protected readonly avatarFailed = signal<ReadonlySet<number>>(new Set());

  protected readonly statusLabel = statusLabel;
  protected readonly roleLabel = roleLabel;

  /** Connection-info disclosure (media credentials) — collapsed by default. */
  protected readonly showConnectionInfo = signal(false);

  /** Emoji picker popover — closed by selection, outside click, Escape, leaving. */
  protected readonly reactionPickerOpen = signal(false);
  protected readonly reactionOptions = REACTIONS;
  protected readonly reactionLabels: Record<ReactionKey, TranslationKey> = {
    heart: 'meetingRoom.reactHeart',
    laugh: 'meetingRoom.reactLaugh',
    cry: 'meetingRoom.reactCry',
    like: 'meetingRoom.reactLike',
  };

  constructor() {
    this.destroyRef.onDestroy(() => this.roomService.stop());
    // Leaving the live room (leave/end/remove) closes the picker with it.
    effect(() => {
      if (this.roomService.viewState() !== 'joined') {
        this.reactionPickerOpen.set(false);
      }
    });
  }

  ngOnInit(): void {
    const joinCode = this.route.snapshot.paramMap.get('joinCode');
    if (joinCode !== null && joinCode !== '') {
      this.roomService.start(joinCode.toUpperCase());
    }
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

  protected toggleHandRaised(): void {
    this.roomService.setSelfHandRaised(!(this.roomService.me()?.handRaised ?? false));
  }

  protected toggleReactionPicker(): void {
    this.reactionPickerOpen.update((open) => !open);
  }

  protected sendReaction(reaction: ReactionKey): void {
    this.reactionPickerOpen.set(false);
    this.roomService.sendReaction(reaction);
  }

  /** The emoji char a float renders for a reaction key. */
  protected reactionChar(reaction: ReactionKey): string {
    return REACTIONS.find((option) => option.key === reaction)?.char ?? '';
  }

  /** Deterministic lane per float — spreads bursts without inline randomness. */
  protected reactionLaneLeft(id: number): string {
    return MeetingRoom.REACTION_LANES[id % MeetingRoom.REACTION_LANES.length]!;
  }

  /** Header-dropdown recipe: anything outside the component closes the picker. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.reactionPickerOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.reactionPickerOpen.set(false);
  }

  protected toggleSelfVideo(): void {
    this.roomService.toggleSelfVideo();
  }

  protected toggleSelfScreenShare(): void {
    this.roomService.toggleSelfScreenShare();
  }

  /**
   * The track a tile renders: own local camera preview while publishing,
   * a subscribed remote camera otherwise (null → avatar with initials).
   */
  protected tileTrack(participant: Participant): VideoTrack | null {
    const facade = this.roomService.mediaFacade;
    if (participant.userId === this.roomService.myUserId()) {
      return facade.cameraPublishing() ? facade.localCameraTrack() : null;
    }
    return facade.remoteCameraTracks().get(participant.userId) ?? null;
  }

  /** Avatar <img> error → initials for that tile (per session). */
  protected noteAvatarError(userId: number): void {
    this.avatarFailed.update((failed) => new Set(failed).add(userId));
  }

  protected avatarUrlFor(participant: Participant): string | null {
    if (this.avatarFailed().has(participant.userId)) {
      return null;
    }
    return this.stageAvatar.urlFor(participant.userId);
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
