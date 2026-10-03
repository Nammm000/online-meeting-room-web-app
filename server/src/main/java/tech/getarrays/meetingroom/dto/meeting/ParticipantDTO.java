package tech.getarrays.meetingroom.dto.meeting;

import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;

import java.time.LocalDateTime;

/**
 * Roster/lobby entry. Note {@code muted} is audio-only by design — camera
 * state is ephemeral presence (LiveKit track events), never persisted.
 */
public record ParticipantDTO(
        Long userId,
        String name,
        ParticipantRole role,
        ParticipantStatus status,
        boolean muted,
        boolean speaking,
        int joinCount,
        LocalDateTime firstJoinedAt,
        LocalDateTime lastJoinedAt,
        LocalDateTime lastLeftAt,
        LocalDateTime lastSpeakingAt,
        String admittedByName) {
}
