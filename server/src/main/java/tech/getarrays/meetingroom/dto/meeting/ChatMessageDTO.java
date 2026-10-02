package tech.getarrays.meetingroom.dto.meeting;

import java.time.LocalDateTime;

/** Visible chat message (soft-deleted ones are excluded at the query level). */
public record ChatMessageDTO(
        Long id,
        Long senderId,
        String senderName,
        String content,
        LocalDateTime sentAt) {
}
