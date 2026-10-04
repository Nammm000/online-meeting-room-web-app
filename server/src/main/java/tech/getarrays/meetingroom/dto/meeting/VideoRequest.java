package tech.getarrays.meetingroom.dto.meeting;

/** Self camera and host camera-off payload; hosts may only send {@code false}. */
public record VideoRequest(Boolean videoEnabled) {
}
