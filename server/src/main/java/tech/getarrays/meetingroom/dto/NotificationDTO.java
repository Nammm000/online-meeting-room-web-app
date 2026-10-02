package tech.getarrays.meetingroom.dto;

/**
 * Payload broadcast to every open /ws/notifications session.
 * {@code timestamp} is deliberately a String (ISO-8601 UTC via Instant.toString())
 * so any ObjectMapper serializes it without JavaTimeModule concerns.
 */
public record NotificationDTO(String message, String timestamp) {
}
