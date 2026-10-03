package tech.getarrays.meetingroom.dto.meeting;

import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingType;

import java.time.LocalDateTime;

/**
 * Meeting summary. {@code media} is populated only for the host/create/start
 * responses — never in list views.
 */
public record MeetingDTO(
        Long id,
        String joinCode,
        String title,
        String description,
        MeetingType type,
        MeetingStatus status,
        LocalDateTime scheduledStartAt,
        LocalDateTime scheduledEndAt,
        LocalDateTime actualStartAt,
        LocalDateTime endedAt,
        LocalDateTime createdAt,
        boolean waitingRoomEnabled,
        boolean muteOnEntry,
        boolean locked,
        boolean hasPassword,
        Long hostId,
        String hostName,
        MediaCredentialsDTO media) {

    public static MeetingDTO summaryOf(Long id, String joinCode, String title, MeetingType type,
                                       MeetingStatus status, boolean locked, boolean hasPassword,
                                       boolean waitingRoomEnabled, boolean muteOnEntry, Long hostId,
                                       String hostName, LocalDateTime createdAt) {
        return new MeetingDTO(id, joinCode, title, null, type, status, null, null, null, null,
                createdAt, waitingRoomEnabled, muteOnEntry, locked, hasPassword, hostId, hostName, null);
    }
}
