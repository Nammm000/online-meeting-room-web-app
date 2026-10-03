package tech.getarrays.meetingroom.services.user;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import tech.getarrays.meetingroom.exception.UserNotFoundException;
import tech.getarrays.meetingroom.models.AccountLevel;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;
import tech.getarrays.meetingroom.repo.AccountLevelRepo;
import tech.getarrays.meetingroom.repo.MeetingChatMessageRepo;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.repo.UserRepo;
import tech.getarrays.meetingroom.services.auth.refreshToken.RefreshTokenService;
import tech.getarrays.meetingroom.services.image.UserImageService;
import tech.getarrays.meetingroom.services.pdf.UserPdfFileService;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    private static final String PLACEHOLDER_EMAIL = "DELETED_USER@gmail.com";

    @Mock UserRepo userRepo;
    @Mock RefreshTokenService refreshTokenService;
    @Mock MeetingRepo meetingRepo;
    @Mock MeetingParticipantRepo participantRepo;
    @Mock MeetingChatMessageRepo chatMessageRepo;
    @Mock UserPdfFileService userPdfFileService;
    @Mock UserImageService userImageService;
    @Mock AccountLevelRepo accountLevelRepo;
    @Mock PasswordEncoder passwordEncoder;

    private UserService service;

    @BeforeEach
    void setUp() {
        service = new UserService(userRepo, refreshTokenService, meetingRepo, participantRepo,
                chatMessageRepo, userPdfFileService, userImageService, accountLevelRepo, passwordEncoder);
    }

    private User user(Long id, String email) {
        User user = new User();
        user.setId(id);
        user.setEmail(email);
        return user;
    }

    private Meeting meeting(Long id) {
        Meeting meeting = new Meeting();
        meeting.setId(id);
        return meeting;
    }

    private User existingPlaceholder() {
        User placeholder = user(99L, PLACEHOLDER_EMAIL);
        placeholder.setName("DELETED_USER");
        return placeholder;
    }

    @Test
    void deletesHostedMeetingsChatFirstThenParticipantsThenMeetingRows() {
        User user = user(5L, "host@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());
        when(meetingRepo.findByHostId(5L)).thenReturn(List.of(meeting(1L), meeting(2L)));

        service.deleteUser(5L);

        InOrder inOrder = inOrder(chatMessageRepo, participantRepo, meetingRepo);
        inOrder.verify(chatMessageRepo).deleteAllByMeetingId(1L);
        inOrder.verify(participantRepo).deleteAllByMeetingId(1L);
        inOrder.verify(chatMessageRepo).deleteAllByMeetingId(2L);
        inOrder.verify(participantRepo).deleteAllByMeetingId(2L);
        inOrder.verify(meetingRepo).deleteAllByHostId(5L);
    }

    @Test
    void erasesChatFootprintAndNullsAuditRefs() {
        User user = user(5L, "chatter@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());

        service.deleteUser(5L);

        verify(chatMessageRepo).deleteAllBySenderId(5L);
        verify(chatMessageRepo).deleteAllByRecipientId(5L);
        verify(chatMessageRepo).updateDeletedByToNull(5L);
        verify(refreshTokenService).deleteAllByUserId(5L);
    }

    @Test
    void reassignsParticipantsToLeftPlaceholderRowsAfterClearingConflicts() {
        User user = user(5L, "participant@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());

        service.deleteUser(5L);

        InOrder inOrder = inOrder(participantRepo);
        inOrder.verify(participantRepo).deletePlaceholderRowsInMeetingsOf(99L, 5L);
        inOrder.verify(participantRepo).reassignToPlaceholder(eq(99L), eq(5L),
                eq(ParticipantRole.PARTICIPANT), eq(ParticipantStatus.LEFT), any(LocalDateTime.class));
        inOrder.verify(participantRepo).updateAdmittedByToNull(5L);
    }

    @Test
    void createsPlaceholderLazilyWithLockedOutCredentials() {
        User user = user(5L, "someone@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(null);
        when(accountLevelRepo.findByCode("BASIC")).thenReturn(Optional.of(AccountLevel.builder()
                .code("BASIC").name("Basic").description("Default account level").build()));
        when(passwordEncoder.encode(anyString())).thenReturn("bcrypt-hash");
        when(userRepo.saveAndFlush(any(User.class))).thenAnswer(invocation -> {
            User saved = invocation.getArgument(0);
            saved.setId(77L);
            return saved;
        });

        service.deleteUser(5L);

        ArgumentCaptor<String> rawPassword = ArgumentCaptor.forClass(String.class);
        verify(passwordEncoder).encode(rawPassword.capture());
        assertThat(rawPassword.getValue()).isNotBlank();

        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(userRepo).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getName()).isEqualTo("DELETED_USER");
        assertThat(saved.getValue().getEmail()).isEqualTo(PLACEHOLDER_EMAIL);
        assertThat(saved.getValue().getPhone()).isEqualTo("0000000000");
        assertThat(saved.getValue().getRole()).isEqualTo(User.Role.ROLE_USER);
        assertThat(saved.getValue().getStatus()).isEqualTo("false");
        assertThat(saved.getValue().getPasswordHash()).isEqualTo("bcrypt-hash");
        assertThat(saved.getValue().getAccountNumber()).startsWith("ACC-");
        assertThat(saved.getValue().getAccountLevel().getCode()).isEqualTo("BASIC");
        assertThat(saved.getValue().getCreatedAt()).isNotNull();

        // The freshly created placeholder is the reassignment target.
        verify(participantRepo).deletePlaceholderRowsInMeetingsOf(77L, 5L);
        // The placeholder's own tokens are never touched — only the deleted user's.
        verify(refreshTokenService).deleteAllByUserId(5L);
    }

    @Test
    void reusesExistingPlaceholderWithoutSaving() {
        User user = user(5L, "someone@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());

        service.deleteUser(5L);

        verify(participantRepo).reassignToPlaceholder(eq(99L), eq(5L),
                eq(ParticipantRole.PARTICIPANT), eq(ParticipantStatus.LEFT), any(LocalDateTime.class));
        verify(userRepo, never()).saveAndFlush(any());
        verifyNoInteractions(accountLevelRepo, passwordEncoder);
    }

    @Test
    void placeholderSelfDeleteHardDeletesItsParticipantRows() {
        // Lowercase on purpose: placeholder detection must be case-insensitive.
        User placeholder = user(7L, "deleted_user@gmail.com");
        when(userRepo.findById(7L)).thenReturn(Optional.of(placeholder));

        service.deleteUser(7L);

        verify(participantRepo).deleteAllByUserId(7L);
        verify(participantRepo, never()).reassignToPlaceholder(any(), any(), any(), any(), any());
        verify(participantRepo, never()).deletePlaceholderRowsInMeetingsOf(any(), any());
        verify(userRepo, never()).findFirstByEmail(anyString());
        verify(userRepo, never()).saveAndFlush(any());
        // Still cleans up its own auth rows and files.
        verify(refreshTokenService).deleteAllByUserId(7L);
        verify(userPdfFileService).deleteAllForUser(7L);
        verify(userImageService).deleteAvatarForUser(7L);
    }

    @Test
    void throwsUserNotFoundAndTouchesNothing() {
        when(userRepo.findById(42L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.deleteUser(42L))
                .isInstanceOf(UserNotFoundException.class);

        verify(userRepo, never()).delete(any());
        verifyNoMoreInteractions(userRepo);
        verifyNoInteractions(refreshTokenService, meetingRepo, participantRepo, chatMessageRepo,
                userPdfFileService, userImageService, accountLevelRepo, passwordEncoder);
    }

    @Test
    void flushesUserRowBeforeBestEffortStorageCleanup() {
        User user = user(5L, "files@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());
        when(userPdfFileService.deleteAllForUser(5L)).thenReturn(List.of("pdfs/5/a.pdf", "pdfs/5/b.pdf"));
        when(userImageService.deleteAvatarForUser(5L)).thenReturn("avatars/5/x.png");

        service.deleteUser(5L);

        InOrder inOrder = inOrder(userRepo, userPdfFileService, userImageService);
        inOrder.verify(userRepo).delete(user);
        inOrder.verify(userRepo).flush();
        inOrder.verify(userPdfFileService).removeObjects(List.of("pdfs/5/a.pdf", "pdfs/5/b.pdf"));
        inOrder.verify(userImageService).removeAvatarObject("avatars/5/x.png");
    }

    @Test
    void skipsAvatarObjectRemovalWhenUserHasNoAvatar() {
        User user = user(5L, "plain@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());

        service.deleteUser(5L);

        verify(userImageService, never()).removeAvatarObject(anyString());
    }

    @Test
    void returnsSuccessResponse() {
        User user = user(5L, "gone@example.com");
        when(userRepo.findById(5L)).thenReturn(Optional.of(user));
        when(userRepo.findFirstByEmail(PLACEHOLDER_EMAIL)).thenReturn(existingPlaceholder());

        var response = service.deleteUser(5L);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("User deleted successfully");
    }
}
