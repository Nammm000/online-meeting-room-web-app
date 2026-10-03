package tech.getarrays.meetingroom.dto.meeting;

/** Chat send payload — plain text, non-blank, ≤ 2000 chars; a recipientUserId makes it private. */
public record SendChatRequest(String content, Long recipientUserId) {
}
