package tech.getarrays.meetingroom.dto.meeting;

/** Self speaking-state payload; the service clamps to false while muted. */
public record SpeakingRequest(Boolean speaking) {
}
