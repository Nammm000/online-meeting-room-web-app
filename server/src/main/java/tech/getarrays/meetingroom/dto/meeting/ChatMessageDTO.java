package tech.getarrays.meetingroom.dto.meeting;

import java.time.LocalDateTime;

/** Visible chat message (soft-deleted ones are excluded at the query level). Private messages carry the recipient. */
public record ChatMessageDTO(
        Long id,
        Long senderId,
        String senderName,
        Long recipientId,
        String recipientName,
        String content,
        LocalDateTime sentAt) {
}
