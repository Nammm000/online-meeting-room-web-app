package tech.getarrays.meetingroom.services.meeting;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import tech.getarrays.meetingroom.configuration.RequestSecurityContext;
import tech.getarrays.meetingroom.dto.meeting.MyMeetingStatusDTO;
import tech.getarrays.meetingroom.exception.ConflictException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingType;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.repo.UserRepo;
import tech.getarrays.meetingroom.services.media.JanusAudioBridgeClient;
import tech.getarrays.meetingroom.services.media.LiveKitMediaService;
import tech.getarrays.meetingroom.services.media.MediaTokenService;
import tech.getarrays.meetingroom.util.UserUtils;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MeetingParticipantServiceTest {

    private MeetingParticipantRepo participantRepo;
    private MeetingAuthority authority;
    private MeetingStateService stateService;
    private MediaTokenService mediaTokenService;
    private LiveKitMediaService liveKitMediaService;
    private JanusAudioBridgeClient janusAudioBridgeClient;
    private MeetingParticipantService service;
    private UserRepo userRepo;
    private RequestSecurityContext securityContext;

    private final User host = User.builder().id(2L).name("Host").email("host@t.dev").build();
    private final User cohost = User.builder().id(8L).name("CoHost").email("cohost@t.dev").build();
    private final User guest = User.builder().id(9L).name("Guest").email("guest@t.dev").build();
    private Meeting meeting;

    @BeforeEach
    void setUp() {
        participantRepo = mock(MeetingParticipantRepo.class);
        authority = mock(MeetingAuthority.class);
        stateService = mock(MeetingStateService.class);
        mediaTokenService = mock(MediaTokenService.class);
        liveKitMediaService = mock(LiveKitMediaService.class);
        janusAudioBridgeClient = mock(JanusAudioBridgeClient.class);
        service = new MeetingParticipantService(participantRepo, authority, stateService,
                mediaTokenService, liveKitMediaService, janusAudioBridgeClient);

        // Seed UserUtils' statics so getCurrentUser() resolves users in this test JVM;
        // tests re-point the current user via setCurrentUser(...)
        userRepo = mock(UserRepo.class);
        securityContext = new RequestSecurityContext();
        new UserUtils(userRepo, securityContext);
        setCurrentUser(host);

        meeting = Meeting.builder().host(host).title("T").joinCode("ABCD234567")
                .type(MeetingType.INSTANT).status(MeetingStatus.IN_PROGRESS).build();
        meeting.setId(1L);
        when(authority.requireMeetingByJoinCode("ABCD234567")).thenReturn(meeting);
    }

    private void setCurrentUser(User user) {
        securityContext.setUsername(user.getEmail());
        when(userRepo.findFirstByEmail(user.getEmail())).thenReturn(user);
    }

    private MeetingParticipant row(User user, ParticipantRole role, ParticipantStatus status) {
        return MeetingParticipant.builder().meeting(meeting).user(user).role(role).status(status).build();
    }

    @Test
    void joinRunsTheGuardsThenTheStateTransition() {
        when(stateService.joinParticipant(meeting, host)).thenReturn(row(host, ParticipantRole.HOST,
                ParticipantStatus.JOINED));

        service.join("ABCD234567");

        verify(authority).requireStatus(meeting, MeetingStatus.IN_PROGRESS);
        verify(authority).requireNotLocked(meeting);
        verify(stateService).joinParticipant(meeting, host);
    }

    @Test
    void mediaIsMintedOnlyForJoinedParticipantsOfInProgressMeetings() {
        assertThat(service.myStatus("ABCD234567").media()).isNull(); // no participant row at all
        verify(mediaTokenService, never()).mintFor(any(), any());

        when(authority.callerParticipant(meeting, host))
                .thenReturn(Optional.of(row(host, ParticipantRole.PARTICIPANT, ParticipantStatus.WAITING)));
        assertThat(service.myStatus("ABCD234567").media())
                .as("waiting-room participants never receive credentials").isNull();
        verify(mediaTokenService, never()).mintFor(any(), any());

        when(authority.callerParticipant(meeting, host))
                .thenReturn(Optional.of(row(host, ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED)));
        when(mediaTokenService.mintFor(any(), any())).thenReturn(new tech.getarrays.meetingroom.dto.meeting.MediaCredentialsDTO(
                "http://localhost:7880", "jwt", "ws://localhost:8188", 1L, "pin", false));
        MyMeetingStatusDTO status = service.myStatus("ABCD234567");
        assertThat(status.media()).isNotNull();
        assertThat(status.participant().status()).isEqualTo(ParticipantStatus.JOINED);

        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<MeetingParticipant> minted =
                org.mockito.ArgumentCaptor.forClass(MeetingParticipant.class);
        verify(mediaTokenService).mintFor(org.mockito.ArgumentMatchers.eq(meeting), minted.capture());
        assertThat(minted.getValue().getStatus()).isEqualTo(ParticipantStatus.JOINED);
    }

    @Test
    void mediaIsNotMintedWhenTheMeetingIsNoLongerInProgress() {
        meeting.setStatus(MeetingStatus.ENDED);
        when(authority.callerParticipant(meeting, host))
                .thenReturn(Optional.of(row(host, ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED)));

        assertThat(service.myStatus("ABCD234567").media()).isNull();
        verify(mediaTokenService, never()).mintFor(any(), any());
    }

    @Test
    void lobbyRequiresHostOrCohost() {
        service.lobby("ABCD234567");
        verify(authority).requireHostOrCohost(meeting, host);
    }

    @Test
    void hostMuteHitsTheBridgeBeforeTheDatabase() { // doc §5.4 ordering
        when(authority.requireHostOrCohost(meeting, host))
                .thenReturn(row(host, ParticipantRole.HOST, ParticipantStatus.JOINED));
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L))
                .thenReturn(Optional.of(row(guest, ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED)));

        service.muteParticipant("ABCD234567", 9L, true);

        InOrder order = inOrder(janusAudioBridgeClient, stateService);
        order.verify(janusAudioBridgeClient).adminMute(1L, 9L, true);
        order.verify(stateService).setMuted(1L, 9L, true);
    }

    @Test
    void nobodyMutesTheHost() {
        setCurrentUser(cohost); // a co-host other than the host attempts the mute
        when(authority.requireHostOrCohost(meeting, cohost))
                .thenReturn(row(cohost, ParticipantRole.COHOST, ParticipantStatus.JOINED));
        when(participantRepo.findByMeetingIdAndUserId(1L, 2L))
                .thenReturn(Optional.of(row(host, ParticipantRole.HOST, ParticipantStatus.JOINED)));

        assertThatThrownBy(() -> service.muteParticipant("ABCD234567", 2L, true))
                .isInstanceOf(ConflictException.class);
        verify(stateService, never()).setMuted(any(), any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void removeRejectsHostTargetsAndCohostRemovingCohost() {
        when(authority.requireHostOrCohost(meeting, host))
                .thenReturn(row(host, ParticipantRole.HOST, ParticipantStatus.JOINED));
        when(participantRepo.findByMeetingIdAndUserId(1L, 2L))
                .thenReturn(Optional.of(row(host, ParticipantRole.HOST, ParticipantStatus.JOINED)));
        assertThatThrownBy(() -> service.removeParticipant("ABCD234567", 2L))
                .isInstanceOf(ConflictException.class);

        when(authority.requireHostOrCohost(meeting, host))
                .thenReturn(row(host, ParticipantRole.COHOST, ParticipantStatus.JOINED));
        when(participantRepo.findByMeetingIdAndUserId(1L, 8L))
                .thenReturn(Optional.of(row(User.builder().id(8L).build(), ParticipantRole.COHOST,
                        ParticipantStatus.JOINED)));
        assertThatThrownBy(() -> service.removeParticipant("ABCD234567", 8L))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        verify(stateService, never()).remove(any(), any());
    }

    @Test
    void removeTearsDownBothPlanesAfterTheDbTransition() {
        when(authority.requireHostOrCohost(meeting, host))
                .thenReturn(row(host, ParticipantRole.HOST, ParticipantStatus.JOINED));
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L))
                .thenReturn(Optional.of(row(guest, ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED)));

        service.removeParticipant("ABCD234567", 9L);

        InOrder order = inOrder(stateService, liveKitMediaService, janusAudioBridgeClient);
        order.verify(stateService).remove(1L, 9L);
        order.verify(liveKitMediaService).removeParticipant("ABCD234567", 9L);
        order.verify(janusAudioBridgeClient).kick(1L, 9L);
    }

    @Test
    void lockIsHostOnlyAndTouchesNoMediaServer() {
        when(authority.requireHost(meeting, host))
                .thenReturn(row(host, ParticipantRole.HOST, ParticipantStatus.JOINED));

        service.setLocked("ABCD234567", true);

        verify(authority).requireHost(meeting, host);
        verify(stateService).setLocked(1L, true);
        verify(liveKitMediaService, never()).ensureRoom(any());
        verify(janusAudioBridgeClient, never()).ensureRoom(any());
    }
}
