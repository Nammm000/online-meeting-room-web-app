package tech.getarrays.meetingroom.dto.meeting;

/** Self/moderator raised-hand payload; no mute clamp — a raised hand while muted is legitimate. */
public record HandRequest(Boolean handRaised) {
}
