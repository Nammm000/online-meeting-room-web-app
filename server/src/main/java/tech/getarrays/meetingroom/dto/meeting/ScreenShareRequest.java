package tech.getarrays.meetingroom.dto.meeting;

/** Self screen-share claim/release and host stop payload; hosts may only send {@code false}. */
public record ScreenShareRequest(Boolean sharing) {
}
