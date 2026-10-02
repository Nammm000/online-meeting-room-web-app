package tech.getarrays.meetingroom.dto.meeting;

/** Chat send payload — plain text, non-blank, ≤ 2000 chars. */
public record SendChatRequest(String content) {
}
