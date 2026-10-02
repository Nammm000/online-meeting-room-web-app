package tech.getarrays.meetingroom.services.meeting;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.dto.PagedResponseDTO;
import tech.getarrays.meetingroom.dto.meeting.ChatMessageDTO;
import tech.getarrays.meetingroom.exception.NotFoundException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.MeetingChatMessage;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.repo.MeetingChatMessageRepo;
import tech.getarrays.meetingroom.util.UserUtils;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Persisted in-meeting chat. History is viewable by any past-or-present
 * participant — including after the meeting ends (the design's "viewable
 * after end" rule); sending is the restricted direction and requires the
 * meeting IN_PROGRESS and the sender JOINED (rule 3). Paging uses the fixed
 * server-side sort {@code sentAt DESC, id DESC} (id breaks same-second ties),
 * the same convention as the pdf-files list.
 */
@Service
public class MeetingChatService {

    private static final int MAX_CONTENT_LENGTH = 2000;

    private final MeetingChatMessageRepo chatRepo;
    private final MeetingAuthority authority;

    public MeetingChatService(MeetingChatMessageRepo chatRepo, MeetingAuthority authority) {
        this.chatRepo = chatRepo;
        this.authority = authority;
    }

    public PagedResponseDTO<ChatMessageDTO> getMessages(String joinCode, int page, int size) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireAnyParticipant(meeting, UserUtils.getCurrentUser());
        Page<MeetingChatMessage> messages = chatRepo.findByMeetingIdAndDeletedAtIsNull(meeting.getId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "sentAt").and(Sort.by(Sort.Direction.DESC, "id"))));
        List<ChatMessageDTO> content = messages.stream().map(this::toDto).toList();
        return PagedResponseDTO.from(new PageImpl<>(content, messages.getPageable(), messages.getTotalElements()));
    }

    public ChatMessageDTO send(String joinCode, String content) {
        if (content == null || content.isBlank()) {
            throw new IllegalArgumentException("Message content is required");
        }
        if (content.length() > MAX_CONTENT_LENGTH) {
            throw new IllegalArgumentException("Message content exceeds " + MAX_CONTENT_LENGTH + " characters");
        }
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireStatus(meeting, MeetingStatus.IN_PROGRESS);
        User caller = UserUtils.getCurrentUser();
        authority.requireJoined(meeting, caller);

        MeetingChatMessage message = MeetingChatMessage.builder()
                .meeting(meeting)
                .sender(caller)
                .content(content)
                .build();
        return toDto(chatRepo.save(message));
    }

    /** Soft delete — author or host; idempotent for already-deleted messages. */
    public void delete(String joinCode, Long messageId) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        MeetingChatMessage message = chatRepo.findById(messageId)
                .filter(m -> m.getMeeting().getId().equals(meeting.getId()))
                .orElseThrow(() -> new NotFoundException("Message not found"));
        boolean author = message.getSender().getId().equals(caller.getId());
        boolean host = authority.callerParticipant(meeting, caller)
                .map(p -> p.getRole() == ParticipantRole.HOST)
                .orElse(false);
        if (!author && !host) {
            throw new AccessDeniedException("Only the author or the host may delete a message");
        }
        chatRepo.softDelete(messageId, caller.getId(), LocalDateTime.now());
    }

    private ChatMessageDTO toDto(MeetingChatMessage message) {
        return new ChatMessageDTO(message.getId(), message.getSender().getId(), message.getSender().getName(),
                message.getContent(), message.getSentAt());
    }
}
