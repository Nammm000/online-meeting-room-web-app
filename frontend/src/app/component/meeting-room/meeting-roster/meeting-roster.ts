import { Component, inject } from '@angular/core';
import { MeetingRoomService } from 'service/meeting-room.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import { participantRoleLabel as roleLabel } from 'util/meeting-labels';
import type { Participant } from 'model/meeting.model';

/**
 * Roster + host lobby drawer, both fed by the room store's 5 s secondary
 * cycle. Row actions mirror the backend's MeetingAuthority gates exactly so
 * the UI never offers a button the server would refuse: moderators can mute
 * others (never the host row), only the host promotes/demotes (never on the
 * host row), removal follows HOST-vs-COHOST reach, and the lobby shows for
 * moderators only.
 */
@Component({
  selector: 'app-meeting-roster',
  imports: [],
  templateUrl: './meeting-roster.html',
  styleUrl: './meeting-roster.scss',
})
export class MeetingRoster {
  protected readonly roomService = inject(MeetingRoomService);
  private readonly modalService = inject(ModalService);
  protected readonly langService = inject(LanguageService);

  protected readonly roleLabel = roleLabel;

  /** Moderator can mute this row (host rows are rejected server-side). */
  protected canMute(participant: Participant): boolean {
    return this.roomService.canModerate() && participant.role !== 'HOST';
  }

  /** Moderator can lower a raised hand; shown only while the hand is up so rows stay clean. */
  protected canLowerHand(participant: Participant): boolean {
    return (
      this.roomService.canModerate() && participant.handRaised && participant.role !== 'HOST'
    );
  }

  /** Host promotes/demotes co-hosts; the host row itself is immutable. */
  protected canChangeRole(participant: Participant): boolean {
    return this.roomService.isHost() && participant.role !== 'HOST';
  }

  /** HOST removes anyone but themselves; COHOST only plain participants. */
  protected canRemove(participant: Participant): boolean {
    if (participant.role === 'HOST') {
      return false;
    }
    if (this.roomService.isHost()) {
      return true;
    }
    return this.roomService.isCohost() && participant.role === 'PARTICIPANT';
  }

  protected mute(participant: Participant): void {
    this.roomService.muteParticipant(participant.userId, !participant.muted);
  }

  protected toggleRole(participant: Participant): void {
    this.roomService.setRole(
      participant.userId,
      participant.role === 'COHOST' ? 'PARTICIPANT' : 'COHOST',
    );
  }

  protected confirmRemove(participant: Participant): void {
    this.modalService.openConfirmation({
      title: this.langService.t('meetingRoom.removeTitle'),
      message: this.langService.t('meetingRoom.removeMessage'),
      confirmLabel: this.langService.t('meetingRoom.removeConfirm'),
      danger: true,
      onConfirm: () => this.roomService.removeParticipant(participant.userId),
    });
  }

  protected admit(participant: Participant): void {
    this.roomService.admitUser(participant.userId);
  }

  protected deny(participant: Participant): void {
    this.roomService.denyUser(participant.userId);
  }
}
