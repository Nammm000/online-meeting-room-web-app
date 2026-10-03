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
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.UserRepo;
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
    private final MeetingParticipantRepo participantRepo;
    private final UserRepo userRepo;

    public MeetingChatService(MeetingChatMessageRepo chatRepo, MeetingAuthority authority,
                              MeetingParticipantRepo participantRepo, UserRepo userRepo) {
        this.chatRepo = chatRepo;
        this.authority = authority;
        this.participantRepo = participantRepo;
        this.userRepo = userRepo;
    }

    /** Page of messages visible to the caller: broadcasts plus their own private traffic. */
    public PagedResponseDTO<ChatMessageDTO> getMessages(String joinCode, int page, int size) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        authority.requireAnyParticipant(meeting, caller);
        Page<MeetingChatMessage> messages = chatRepo.findVisibleByMeetingAndViewer(meeting.getId(), caller.getId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "sentAt").and(Sort.by(Sort.Direction.DESC, "id"))));
        List<ChatMessageDTO> content = messages.stream().map(this::toDto).toList();
        return PagedResponseDTO.from(new PageImpl<>(content, messages.getPageable(), messages.getTotalElements()));
    }

    public ChatMessageDTO send(String joinCode, String content, Long recipientUserId) {
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
        User recipient = resolveRecipient(meeting, caller, recipientUserId);

        MeetingChatMessage message = MeetingChatMessage.builder()
                .meeting(meeting)
                .sender(caller)
                .recipient(recipient)
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

    /**
     * Private-message recipient: any past-or-present participant of the meeting
     * (history is readable after leave/end, so a recipient who just stepped out
     * still gets the message on rejoin — the client picker only offers JOINED
     * users, this is just the tolerance window). Payload problems are 400s,
     * matching the manual-validation house pattern.
     */
    private User resolveRecipient(Meeting meeting, User caller, Long recipientUserId) {
        if (recipientUserId == null) {
            return null;
        }
        if (recipientUserId.equals(caller.getId())) {
            throw new IllegalArgumentException("Cannot send a private message to yourself");
        }
        if (!participantRepo.existsByMeetingIdAndUserId(meeting.getId(), recipientUserId)) {
            throw new IllegalArgumentException("Recipient is not a participant of this meeting");
        }
        return userRepo.findById(recipientUserId).orElseThrow(() -> new NotFoundException("Recipient not found"));
    }

    private ChatMessageDTO toDto(MeetingChatMessage message) {
        User recipient = message.getRecipient();
        return new ChatMessageDTO(message.getId(), message.getSender().getId(), message.getSender().getName(),
                recipient == null ? null : recipient.getId(), recipient == null ? null : recipient.getName(),
                message.getContent(), message.getSentAt());
    }
}
