import type { TranslationKey } from 'i18n/translations';
import type {
  MeetingStatus,
  MeetingType,
  ParticipantRole,
} from 'model/meeting.model';

/**
 * Static key maps for the enum-valued DTO fields. TranslationKey is a literal
 * union, so runtime key concatenation ('meetings.status' + status) would not
 * type-check — these tables keep every spelling compile-time verified.
 */

export function meetingStatusLabel(status: MeetingStatus): TranslationKey {
  switch (status) {
    case 'SCHEDULED':
      return 'meetings.statusScheduled';
    case 'IN_PROGRESS':
      return 'meetings.statusInProgress';
    case 'ENDED':
      return 'meetings.statusEnded';
    case 'CANCELLED':
      return 'meetings.statusCancelled';
  }
}

export function meetingTypeLabel(type: MeetingType): TranslationKey {
  return type === 'INSTANT' ? 'meetings.typeInstant' : 'meetings.typeScheduled';
}

export function participantRoleLabel(role: ParticipantRole): TranslationKey {
  switch (role) {
    case 'HOST':
      return 'meetingRoom.roleHost';
    case 'COHOST':
      return 'meetingRoom.roleCohost';
    case 'PARTICIPANT':
      return 'meetingRoom.roleParticipant';
  }
}
