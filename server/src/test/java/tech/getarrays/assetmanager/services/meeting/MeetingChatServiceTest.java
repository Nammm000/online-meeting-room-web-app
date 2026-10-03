package tech.getarrays.meetingroom.services.meeting;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.AccessDeniedException;
import tech.getarrays.meetingroom.dto.meeting.ChatMessageDTO;
import tech.getarrays.meetingroom.exception.ConflictException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingType;
import tech.getarrays.meetingroom.models.meeting.MeetingChatMessage;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;
import tech.getarrays.meetingroom.repo.MeetingChatMessageRepo;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.repo.UserRepo;
import tech.getarrays.meetingroom.configuration.RequestSecurityContext;
import tech.getarrays.meetingroom.util.UserUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MeetingChatServiceTest {

    private MeetingChatMessageRepo chatRepo;
    private MeetingRepo meetingRepo;
    private MeetingParticipantRepo participantRepo;
    private UserRepo userRepo;
    private MeetingChatService service;

    private final User host = User.builder().id(2L).name("Host").email("host@t.dev").build();
    private final User guest = User.builder().id(9L).name("Guest").email("guest@t.dev").build();
    private Meeting meeting;

    @BeforeEach
    void setUp() {
        chatRepo = mock(MeetingChatMessageRepo.class);
        meetingRepo = mock(MeetingRepo.class);
        participantRepo = mock(MeetingParticipantRepo.class);
        userRepo = mock(UserRepo.class);
        service = new MeetingChatService(chatRepo, new MeetingAuthority(meetingRepo, participantRepo),
                participantRepo, userRepo);

        // Real MeetingAuthority over mocked repos: the authority logic itself is under test
        RequestSecurityContext securityContext = new RequestSecurityContext();
        securityContext.setUsername(guest.getEmail());
        new UserUtils(userRepo, securityContext);
        when(userRepo.findFirstByEmail(guest.getEmail())).thenReturn(guest);

        meeting = Meeting.builder().host(host).title("T").joinCode("ABCD234567")
                .type(MeetingType.INSTANT).status(MeetingStatus.IN_PROGRESS).build();
        meeting.setId(1L);
        when(meetingRepo.findByJoinCode("ABCD234567")).thenReturn(Optional.of(meeting));
        when(participantRepo.findByMeetingIdAndUserId(1L, guest.getId()))
                .thenReturn(Optional.of(MeetingParticipant.builder()
                        .meeting(meeting).user(guest)
                        .role(ParticipantRole.PARTICIPANT).status(ParticipantStatus.JOINED).build()));
        when(chatRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void sendRequiresTheMeetingToBeInProgress() { // rule 3
        meeting.setStatus(MeetingStatus.ENDED);
        assertThatThrownBy(() -> service.send("ABCD234567", "hello", null))
                .isInstanceOf(ConflictException.class);
        verify(chatRepo, never()).save(any());
    }

    @Test
    void sendRequiresTheSenderToBeJoined() {
        // setUp wires a JOINED row — flip it to LEFT: rule 3 requires JOINED, not merely present
        when(participantRepo.findByMeetingIdAndUserId(1L, guest.getId()))
                .thenReturn(Optional.of(MeetingParticipant.builder()
                        .meeting(meeting).user(guest)
                        .role(ParticipantRole.PARTICIPANT).status(ParticipantStatus.LEFT).build()));
        assertThatThrownBy(() -> service.send("ABCD234567", "hello", null))
                .isInstanceOf(AccessDeniedException.class);
        verify(chatRepo, never()).save(any());
    }

    @Test
    void sendStoresTheMessageAndReturnsTheDto() {
        ChatMessageDTO sent = service.send("ABCD234567", "hello from the test", null);

        assertThat(sent.content()).isEqualTo("hello from the test");
        assertThat(sent.senderId()).isEqualTo(guest.getId());
        assertThat(sent.senderName()).isEqualTo(guest.getName());
        assertThat(sent.recipientId()).as("broadcast by default").isNull();
        assertThat(sent.recipientName()).isNull();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<MeetingChatMessage> saved = ArgumentCaptor.forClass(MeetingChatMessage.class);
        verify(chatRepo).save(saved.capture());
        assertThat(saved.getValue().getMeeting()).isEqualTo(meeting);
        assertThat(saved.getValue().getRecipient()).isNull();
        assertThat(saved.getValue().getMessageType()).isEqualTo(MeetingChatMessage.ChatMessageType.TEXT);
    }

    @Test
    void blankOrOversizeContentIsRejected() {
        assertThatThrownBy(() -> service.send("ABCD234567", "  ", null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.send("ABCD234567", null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.send("ABCD234567", "x".repeat(2001), null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ── private messages ─────────────────────────────────────────────────────

    @Test
    void privateMessagePersistsTheRecipientAndExposesItInTheDto() {
        when(participantRepo.existsByMeetingIdAndUserId(1L, host.getId())).thenReturn(true);
        when(userRepo.findById(host.getId())).thenReturn(Optional.of(host));

        ChatMessageDTO sent = service.send("ABCD234567", "psst", host.getId());

        assertThat(sent.recipientId()).isEqualTo(host.getId());
        assertThat(sent.recipientName()).isEqualTo(host.getName());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<MeetingChatMessage> saved = ArgumentCaptor.forClass(MeetingChatMessage.class);
        verify(chatRepo).save(saved.capture());
        assertThat(saved.getValue().getRecipient()).isEqualTo(host);
    }

    @Test
    void privateMessageToANonParticipantIsRejected() {
        when(participantRepo.existsByMeetingIdAndUserId(1L, host.getId())).thenReturn(false);

        assertThatThrownBy(() -> service.send("ABCD234567", "psst", host.getId()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Recipient is not a participant of this meeting");
        verify(chatRepo, never()).save(any());
    }

    @Test
    void privateMessageToYourselfIsRejected() {
        assertThatThrownBy(() -> service.send("ABCD234567", "note to self", guest.getId()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Cannot send a private message to yourself");
        verify(chatRepo, never()).save(any());
    }

    @Test
    void historyRequiresAnyParticipantRowButNotJoinedStatus() { // viewable after end, by LEFT participants too
        // A meeting the caller has never touched → denied even for reads
        Meeting other = Meeting.builder().host(host).title("O").joinCode("ZZZZ999999")
                .type(MeetingType.INSTANT).status(MeetingStatus.IN_PROGRESS).build();
        other.setId(2L);
        when(meetingRepo.findByJoinCode("ZZZZ999999")).thenReturn(Optional.of(other));
        assertThatThrownBy(() -> service.getMessages("ZZZZ999999", 0, 10))
                .isInstanceOf(AccessDeniedException.class);

        // The caller's own meeting stays readable after it ended (LEFT/ENDED are fine for history)
        meeting.setStatus(MeetingStatus.ENDED);
        when(chatRepo.findVisibleByMeetingAndViewer(any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 10, Sort.by("sentAt")), 0));
        assertThat(service.getMessages("ABCD234567", 0, 10).getTotalElements()).isZero();
    }

    @Test
    void historyScopesVisibilityToTheCallerWithTheFixedSort() {
        when(chatRepo.findVisibleByMeetingAndViewer(any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 10), 0));

        service.getMessages("ABCD234567", 0, 10);

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(chatRepo).findVisibleByMeetingAndViewer(eq(1L), eq(guest.getId()), pageable.capture());
        assertThat(pageable.getValue().getSort())
                .isEqualTo(Sort.by(Sort.Direction.DESC, "sentAt").and(Sort.by(Sort.Direction.DESC, "id")));
    }

    @Test
    void deleteIsForAuthorOrHostOnly() {
        MeetingChatMessage fromHost = MeetingChatMessage.builder()
                .meeting(meeting).sender(host).content("hosts words").build();
        fromHost.setId(5L);
        when(chatRepo.findById(5L)).thenReturn(Optional.of(fromHost));

        // caller (guest) is neither author nor host
        assertThatThrownBy(() -> service.delete("ABCD234567", 5L))
                .isInstanceOf(AccessDeniedException.class);
        verify(chatRepo, never()).softDelete(any(), any(), any());

        // guest's own message: allowed
        MeetingChatMessage fromGuest = MeetingChatMessage.builder()
                .meeting(meeting).sender(guest).content("guests words").build();
        fromGuest.setId(6L);
        when(chatRepo.findById(6L)).thenReturn(Optional.of(fromGuest));
        service.delete("ABCD234567", 6L);
        verify(chatRepo).softDelete(any(), any(), any(LocalDateTime.class));
    }

    @Test
    void messagesFromOtherMeetingsAreNotFound() {
        Meeting otherMeeting = Meeting.builder().host(host).title("X").joinCode("OTHER12345")
                .type(MeetingType.INSTANT).status(MeetingStatus.IN_PROGRESS).build();
        otherMeeting.setId(99L);
        MeetingChatMessage otherMeetingMessage = MeetingChatMessage.builder()
                .meeting(otherMeeting).sender(guest).content("x").build();
        otherMeetingMessage.setId(7L);
        when(chatRepo.findById(7L)).thenReturn(Optional.of(otherMeetingMessage));

        assertThatThrownBy(() -> service.delete("ABCD234567", 7L))
                .isInstanceOf(tech.getarrays.meetingroom.exception.NotFoundException.class);
    }
}
