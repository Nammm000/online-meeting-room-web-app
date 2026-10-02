package tech.getarrays.meetingroom.dto.meeting;

import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;

/** Co-host promote/demote payload — HOST is immutable, requesting it is a 409. */
public record RoleRequest(ParticipantRole role) {
}
