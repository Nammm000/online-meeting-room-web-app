package tech.getarrays.meetingroom.dto.meeting;

import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;

import java.time.LocalDateTime;

/**
 * Roster/lobby entry. {@code muted} is audio-only (the Janus plane);
 * {@code videoEnabled} is the persisted camera entitlement (a host force-off
 * survives rejoin, the participant may re-enable). {@code email} feeds the
 * hover info card on the stage tiles.
 */
public record ParticipantDTO(
        Long userId,
        String name,
        String email,
        ParticipantRole role,
        ParticipantStatus status,
        boolean muted,
        boolean videoEnabled,
        boolean speaking,
        boolean handRaised,
        int joinCount,
        LocalDateTime firstJoinedAt,
        LocalDateTime lastJoinedAt,
        LocalDateTime lastLeftAt,
        LocalDateTime lastSpeakingAt,
        LocalDateTime lastHandRaisedAt,
        String admittedByName) {
}
