package tech.getarrays.meetingroom.services.meeting;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import tech.getarrays.meetingroom.dto.meeting.CreateMeetingRequest;
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

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MeetingStateServiceTest {

    private MeetingRepo meetingRepo;
    private MeetingParticipantRepo participantRepo;
    private MeetingStateService stateService;

    private final User host = User.builder().id(2L).name("Host").email("host@t.dev").build();

    @BeforeEach
    void setUp() {
        meetingRepo = mock(MeetingRepo.class);
        participantRepo = mock(MeetingParticipantRepo.class);
        stateService = new MeetingStateService(meetingRepo, participantRepo, new JoinCodeGenerator(),
                new BCryptPasswordEncoder());
        when(meetingRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(participantRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private Meeting meeting(MeetingStatus status, boolean waitingRoom, boolean muteOnEntry) {
        Meeting m = Meeting.builder()
                .host(host).title("T").joinCode("ABCD234567")
                .type(MeetingType.INSTANT).status(status)
                .waitingRoomEnabled(waitingRoom).muteOnEntry(muteOnEntry)
                .build();
        m.setId(1L);
        return m;
    }

    private MeetingParticipant row(Meeting m, User u, ParticipantRole role, ParticipantStatus status) {
        return MeetingParticipant.builder().meeting(m).user(u).role(role).status(status).build();
    }

    // ── rule 1: creation ─────────────────────────────────────────────────────

    @Test
    void instantMeetingIsBornInProgressWithHostJoinedAndMuteOnEntryApplied() {
        Meeting created = stateService.createMeetingAndHost(host, new CreateMeetingRequest(
                "T", null, MeetingType.INSTANT, null, null, false, true, null));

        assertThat(created.getStatus()).isEqualTo(MeetingStatus.IN_PROGRESS);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<MeetingParticipant> hostRow = ArgumentCaptor.forClass(MeetingParticipant.class);
        verify(participantRepo).save(hostRow.capture());
        assertThat(hostRow.getValue().getRole()).isEqualTo(ParticipantRole.HOST);
        assertThat(hostRow.getValue().getStatus()).isEqualTo(ParticipantStatus.JOINED);
        assertThat(hostRow.getValue().getJoinCount()).isEqualTo(1);
        assertThat(hostRow.getValue().isMuted()).as("mute_on_entry applies to the host too").isTrue();
    }

    @Test
    void scheduledMeetingIsBornScheduledWithHostNotYetJoined() {
        Meeting created = stateService.createMeetingAndHost(host, new CreateMeetingRequest(
                "T", null, MeetingType.SCHEDULED, LocalDateTime.now().plusHours(1),
                LocalDateTime.now().plusHours(2), false, false, null));

        assertThat(created.getStatus()).isEqualTo(MeetingStatus.SCHEDULED);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<MeetingParticipant> hostRow = ArgumentCaptor.forClass(MeetingParticipant.class);
        verify(participantRepo).save(hostRow.capture());
        assertThat(hostRow.getValue().getStatus()).isEqualTo(ParticipantStatus.LEFT);
        assertThat(hostRow.getValue().getJoinCount()).isZero();
    }

    @Test
    void joinCodeCollisionIsRetriedWithAFreshCode() {
        when(meetingRepo.save(any(Meeting.class)))
                .thenThrow(new DataIntegrityViolationException("uq_meetings_join_code"))
                .thenAnswer(inv -> inv.getArgument(0));

        Meeting created = stateService.createMeetingAndHost(host, new CreateMeetingRequest(
                "T", null, MeetingType.INSTANT, null, null, false, false, null));

        verify(meetingRepo, times(2)).save(any(Meeting.class));
        assertThat(created.getJoinCode()).hasSize(10);
    }

    @Test
    void meetingPasswordIsStoredAsABcryptHashOfTheTrimmedValue() {
        Meeting created = stateService.createMeetingAndHost(host, new CreateMeetingRequest(
                "T", null, MeetingType.INSTANT, null, null, false, false, "  secret  "));

        assertThat(created.getPasswordHash()).isNotBlank().isNotEqualTo("secret");
        assertThat(new BCryptPasswordEncoder().matches("secret", created.getPasswordHash())).isTrue();
    }

    @Test
    void blankMeetingPasswordStoresNoHash() {
        Meeting created = stateService.createMeetingAndHost(host, new CreateMeetingRequest(
                "T", null, MeetingType.INSTANT, null, null, false, false, "   "));

        assertThat(created.getPasswordHash()).isNull();
    }

    // ── join / rejoin state machine ──────────────────────────────────────────

    @Test
    void firstJoinWithoutWaitingRoomGoesStraightToJoined() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.empty());

        MeetingParticipant joined = stateService.joinParticipant(m,
                User.builder().id(9L).name("Guest").build());

        assertThat(joined.getStatus()).isEqualTo(ParticipantStatus.JOINED);
        assertThat(joined.getJoinCount()).isEqualTo(1);
        assertThat(joined.getFirstJoinedAt()).isNotNull();
    }

    @Test
    void firstJoinWithWaitingRoomStaysWaiting() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, true, false);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.empty());

        assertThat(stateService.joinParticipant(m, User.builder().id(9L).build()).getStatus())
                .isEqualTo(ParticipantStatus.WAITING);
    }

    @Test
    void leftParticipantRejoinsInPlaceWithIncrementedCount() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        MeetingParticipant left = row(m, User.builder().id(9L).build(), ParticipantRole.PARTICIPANT,
                ParticipantStatus.LEFT);
        left.setJoinCount(1);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.of(left));

        MeetingParticipant rejoined = stateService.joinParticipant(m, User.builder().id(9L).build());

        assertThat(rejoined.getStatus()).isEqualTo(ParticipantStatus.JOINED);
        assertThat(rejoined.getJoinCount()).isEqualTo(2);
    }

    @Test
    void removedParticipantIsForcedBackToTheLobbyEvenWithoutWaitingRoom() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L))
                .thenReturn(Optional.of(row(m, User.builder().id(9L).build(),
                        ParticipantRole.PARTICIPANT, ParticipantStatus.REMOVED)));

        assertThat(stateService.joinParticipant(m, User.builder().id(9L).build()).getStatus())
                .isEqualTo(ParticipantStatus.WAITING);
    }

    // ── admit / end ──────────────────────────────────────────────────────────

    @Test
    void admitAppliesMuteOnEntryAndBookkeeping() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, true, true);
        MeetingParticipant waiting = row(m, User.builder().id(9L).build(),
                ParticipantRole.PARTICIPANT, ParticipantStatus.WAITING);
        when(meetingRepo.findById(1L)).thenReturn(Optional.of(m));
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.of(waiting));

        MeetingParticipant admitted = stateService.admit(1L, 9L, host);

        assertThat(admitted.getStatus()).isEqualTo(ParticipantStatus.JOINED);
        assertThat(admitted.getAdmittedBy()).isEqualTo(host);
        assertThat(admitted.getJoinCount()).isEqualTo(1);
        assertThat(admitted.isMuted()).as("mute_on_entry OR prior muted").isTrue();
    }

    @Test
    void admitRejectsNonWaitingParticipants() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, true, false);
        when(meetingRepo.findById(1L)).thenReturn(Optional.of(m));
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L))
                .thenReturn(Optional.of(row(m, User.builder().id(9L).build(),
                        ParticipantRole.PARTICIPANT, ParticipantStatus.LEFT)));

        assertThatThrownBy(() -> stateService.admit(1L, 9L, host))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void markEndedBulkMovesJoinedToLeftInOneTransaction() { // rule 4
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        when(meetingRepo.findById(1L)).thenReturn(Optional.of(m));

        Meeting ended = stateService.markEnded(1L);

        assertThat(ended.getStatus()).isEqualTo(MeetingStatus.ENDED);
        assertThat(ended.getEndedAt()).isNotNull();
        verify(participantRepo).updateStatusForMeeting(1L, ParticipantStatus.JOINED,
                ParticipantStatus.LEFT, ended.getEndedAt());
    }

    @Test
    void markStartedJoinsTheHostRow() {
        Meeting m = meeting(MeetingStatus.SCHEDULED, false, false);
        m.setStatus(MeetingStatus.SCHEDULED);
        when(meetingRepo.findById(1L)).thenReturn(Optional.of(m));
        MeetingParticipant hostLeft = row(m, host, ParticipantRole.HOST, ParticipantStatus.LEFT);
        when(participantRepo.findByMeetingIdAndUserId(1L, 2L)).thenReturn(Optional.of(hostLeft));

        Meeting started = stateService.markStarted(1L);

        assertThat(started.getStatus()).isEqualTo(MeetingStatus.IN_PROGRESS);
        assertThat(started.getActualStartAt()).isNotNull();
        assertThat(hostLeft.getStatus()).isEqualTo(ParticipantStatus.JOINED);
    }

    @Test
    void markLeftIfJoinedIgnoresNonJoinedRows() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L))
                .thenReturn(Optional.of(row(m, User.builder().id(9L).build(),
                        ParticipantRole.PARTICIPANT, ParticipantStatus.WAITING)));

        stateService.markLeftIfJoined(1L, 9L);

        verify(participantRepo, never()).save(any(MeetingParticipant.class));
    }

    // ── speaking flag ────────────────────────────────────────────────────────

    @Test
    void setSpeakingStampsLastSpeakingAtOnTheRisingEdgeOnly() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        MeetingParticipant participant = row(m, User.builder().id(9L).build(),
                ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.of(participant));

        stateService.setSpeaking(1L, 9L, true);
        assertThat(participant.isSpeaking()).isTrue();
        assertThat(participant.getLastSpeakingAt()).isNotNull();
        LocalDateTime stamp = participant.getLastSpeakingAt();

        stateService.setSpeaking(1L, 9L, false);
        assertThat(participant.isSpeaking()).isFalse();
        assertThat(participant.getLastSpeakingAt()).as("kept while silent — it only orders active speakers")
                .isEqualTo(stamp);
    }

    @Test
    void mutingClearsTheSpeakingFlag() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        MeetingParticipant participant = row(m, User.builder().id(9L).build(),
                ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED);
        participant.setSpeaking(true);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.of(participant));

        stateService.setMuted(1L, 9L, true);

        assertThat(participant.isMuted()).isTrue();
        assertThat(participant.isSpeaking()).isFalse();
    }

    @Test
    void rejoiningResetsTheSpeakingFlag() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        MeetingParticipant left = row(m, User.builder().id(9L).build(),
                ParticipantRole.PARTICIPANT, ParticipantStatus.LEFT);
        left.setJoinCount(1);
        left.setSpeaking(true);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.of(left));

        MeetingParticipant rejoined = stateService.joinParticipant(m, User.builder().id(9L).build());

        assertThat(rejoined.getStatus()).isEqualTo(ParticipantStatus.JOINED);
        assertThat(rejoined.isSpeaking()).isFalse();
    }

    @Test
    void markLeftClearsTheSpeakingFlag() {
        Meeting m = meeting(MeetingStatus.IN_PROGRESS, false, false);
        MeetingParticipant joined = row(m, User.builder().id(9L).build(),
                ParticipantRole.PARTICIPANT, ParticipantStatus.JOINED);
        joined.setSpeaking(true);
        when(participantRepo.findByMeetingIdAndUserId(1L, 9L)).thenReturn(Optional.of(joined));

        stateService.markLeftIfJoined(1L, 9L);

        assertThat(joined.getStatus()).isEqualTo(ParticipantStatus.LEFT);
        assertThat(joined.isSpeaking()).isFalse();
    }
}
