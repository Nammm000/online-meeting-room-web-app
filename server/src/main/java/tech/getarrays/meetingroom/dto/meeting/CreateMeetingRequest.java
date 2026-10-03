package tech.getarrays.meetingroom.dto.meeting;

import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingType;

import java.time.LocalDateTime;

/**
 * Create-meeting payload. SCHEDULED requires both timestamps (end after
 * start); INSTANT must carry none — enforced in MeetingService ( IllegalArgumentException
 * → 400 via the catch-all handler, the house pattern for input validation).
 */
public record CreateMeetingRequest(
        String title,
        String description,
        MeetingType type,
        LocalDateTime scheduledStartAt,
        LocalDateTime scheduledEndAt,
        Boolean waitingRoomEnabled,
        Boolean muteOnEntry,
        String password) {
}
