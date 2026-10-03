package tech.getarrays.meetingroom.dto.meeting;

/** Join payload — carries the optional meeting password (plaintext, compare-only). */
public record JoinRequest(String password) {
}
