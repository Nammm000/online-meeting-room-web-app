package tech.getarrays.meetingroom.dto.meeting;

/**
 * Response of {@code POST /meetings/{joinCode}/join} and the polling endpoint
 * {@code GET /meetings/{joinCode}/me}: the caller's participant state plus
 * media credentials when (and only when) they are JOINED and the meeting is
 * IN_PROGRESS. A waiting-room participant gets {@code media = null} — the
 * lobby client keeps polling until admission flips the status.
 */
public record MyMeetingStatusDTO(
        MeetingDTO meeting,
        ParticipantDTO participant,
        MediaCredentialsDTO media) {
}
