package tech.getarrays.meetingroom.services.meeting;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.dto.meeting.MediaCredentialsDTO;
import tech.getarrays.meetingroom.dto.meeting.MeetingDTO;
import tech.getarrays.meetingroom.dto.meeting.MyMeetingStatusDTO;
import tech.getarrays.meetingroom.dto.meeting.ParticipantDTO;
import tech.getarrays.meetingroom.exception.ConflictException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.services.media.JanusAudioBridgeClient;
import tech.getarrays.meetingroom.services.media.LiveKitMediaService;
import tech.getarrays.meetingroom.services.media.MediaTokenService;
import tech.getarrays.meetingroom.util.UserUtils;

import java.util.List;
import java.util.Objects;

/**
 * Join, lobby, roster and moderation orchestration. NOT @Transactional: DB
 * transitions commit via {@link MeetingStateService} first, media calls follow
 * best-effort. Media credentials are minted only when the caller is JOINED
 * and the meeting IN_PROGRESS — for everyone else {@code media} is null, which
 * is exactly the waiting-room contract (lobby clients poll {@code /me} until
 * admission flips their status).
 */
@Service
public class MeetingParticipantService {

    private final MeetingParticipantRepo participantRepo;
    private final MeetingAuthority authority;
    private final MeetingStateService stateService;
    private final MediaTokenService mediaTokenService;
    private final LiveKitMediaService liveKitMediaService;
    private final JanusAudioBridgeClient janusAudioBridgeClient;
    private final PasswordEncoder passwordEncoder;

    public MeetingParticipantService(MeetingParticipantRepo participantRepo,
                                     MeetingAuthority authority,
                                     MeetingStateService stateService,
                                     MediaTokenService mediaTokenService,
                                     LiveKitMediaService liveKitMediaService,
                                     JanusAudioBridgeClient janusAudioBridgeClient,
                                     PasswordEncoder passwordEncoder) {
        this.participantRepo = participantRepo;
        this.authority = authority;
        this.stateService = stateService;
        this.mediaTokenService = mediaTokenService;
        this.liveKitMediaService = liveKitMediaService;
        this.janusAudioBridgeClient = janusAudioBridgeClient;
        this.passwordEncoder = passwordEncoder;
    }

    public MyMeetingStatusDTO join(String joinCode, String password) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireStatus(meeting, MeetingStatus.IN_PROGRESS);
        authority.requireNotLocked(meeting);
        User caller = UserUtils.getCurrentUser();
        requirePasswordIfSet(meeting, caller, password);
        MeetingParticipant participant = stateService.joinParticipant(meeting, caller);
        return statusOf(meeting, participant);
    }

    /** The lobby/presence polling channel — like join, but never mutates state. */
    public MyMeetingStatusDTO myStatus(String joinCode) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        MeetingParticipant participant = authority.callerParticipant(meeting, caller).orElse(null);
        return statusOf(meeting, participant);
    }

    public void leave(String joinCode) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        stateService.markLeftIfJoined(meeting.getId(), caller.getId());
    }

    public List<ParticipantDTO> lobby(String joinCode) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireHostOrCohost(meeting, UserUtils.getCurrentUser());
        return participantRepo.findByMeetingIdAndStatus(meeting.getId(), ParticipantStatus.WAITING)
                .stream().map(this::toDto).toList();
    }

    public void admit(String joinCode, Long userId) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireHostOrCohost(meeting, UserUtils.getCurrentUser());
        stateService.admit(meeting.getId(), userId, UserUtils.getCurrentUser());
        // No media call: the admitted client picks up tokens on its next /me poll
        // (which also lazily re-ensures both rooms — the self-healing path).
    }

    public void deny(String joinCode, Long userId) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireHostOrCohost(meeting, UserUtils.getCurrentUser());
        stateService.deny(meeting.getId(), userId);
    }

    /** Live roster; the caller must currently be in the meeting or run it. */
    public List<ParticipantDTO> roster(String joinCode) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        MeetingParticipant callerRow = authority.requireAnyParticipant(meeting, UserUtils.getCurrentUser());
        boolean runsMeeting = callerRow.getRole() == ParticipantRole.HOST
                || callerRow.getRole() == ParticipantRole.COHOST;
        if (!runsMeeting && callerRow.getStatus() != ParticipantStatus.JOINED) {
            throw new AccessDeniedException("You are not currently in this meeting");
        }
        return participantRepo.findByMeetingIdAndStatus(meeting.getId(), ParticipantStatus.JOINED)
                .stream().map(this::toDto).toList();
    }

    /** Self-mute: the client mutes at the bridge first (latency), this persists it for rejoin. */
    public void selfMute(String joinCode, boolean muted) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        authority.requireJoined(meeting, caller);
        stateService.setMuted(meeting.getId(), caller.getId(), muted);
    }

    /** Self speaking state from local mic analysis — clamped to false while muted. */
    public void selfSpeaking(String joinCode, boolean speaking) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        MeetingParticipant participant = authority.requireJoined(meeting, caller);
        stateService.setSpeaking(meeting.getId(), caller.getId(), speaking && !participant.isMuted());
    }

    /**
     * Host/co-host mute of another participant. Deliberate ordering (doc §5.4):
     * the AudioBridge admin mute runs BEFORE the DB write, so the flag never
     * claims muted while the mic still feeds the mix; if the DB write then
     * failed, the roster flag self-corrects on the client's next configure.
     */
    public void muteParticipant(String joinCode, Long userId, boolean muted) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        authority.requireHostOrCohost(meeting, caller);
        MeetingParticipant target = requireTarget(meeting, userId);
        if (target.getRole() == ParticipantRole.HOST && !Objects.equals(target.getUser().getId(), caller.getId())) {
            throw new ConflictException("The host cannot be muted by someone else");
        }
        janusAudioBridgeClient.adminMute(meeting.getId(), userId, muted);
        stateService.setMuted(meeting.getId(), userId, muted);
    }

    /** Host remove: DB first, then disconnect + token revocation + bridge kick, all best-effort. */
    public void removeParticipant(String joinCode, Long userId) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        User caller = UserUtils.getCurrentUser();
        MeetingParticipant callerRow = authority.requireHostOrCohost(meeting, caller);
        MeetingParticipant target = requireTarget(meeting, userId);
        if (target.getRole() == ParticipantRole.HOST) {
            throw new ConflictException("The host cannot be removed");
        }
        if (callerRow.getRole() == ParticipantRole.COHOST && target.getRole() == ParticipantRole.COHOST) {
            throw new AccessDeniedException("A co-host cannot remove another co-host");
        }
        stateService.remove(meeting.getId(), userId);
        liveKitMediaService.removeParticipant(meeting.getJoinCode(), userId);
        janusAudioBridgeClient.kick(meeting.getId(), userId);
    }

    /** Lock is a pure DB flag — the token gate (no minting unless JOINED) is the enforcement. */
    public void setLocked(String joinCode, boolean locked) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireHost(meeting, UserUtils.getCurrentUser());
        stateService.setLocked(meeting.getId(), locked);
    }

    public void setRole(String joinCode, Long userId, ParticipantRole role) {
        Meeting meeting = authority.requireMeetingByJoinCode(joinCode);
        authority.requireHost(meeting, UserUtils.getCurrentUser());
        stateService.setRole(meeting.getId(), userId, role);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * Join password gate. 403 (never 401 — the frontend reserves non-auth 401
     * for session death): a password-protected meeting rejects callers who
     * supply no password or a wrong one. The host account is exempt; the gate
     * covers first joins and rejoins alike (they share this entry point).
     */
    private void requirePasswordIfSet(Meeting meeting, User caller, String password) {
        if (meeting.getPasswordHash() == null || meeting.getHost().getId().equals(caller.getId())) {
            return;
        }
        if (password == null || password.isBlank()) {
            throw new AccessDeniedException("This meeting requires a password");
        }
        if (!passwordEncoder.matches(password.trim(), meeting.getPasswordHash())) {
            throw new AccessDeniedException("Incorrect meeting password");
        }
    }

    private MyMeetingStatusDTO statusOf(Meeting meeting, MeetingParticipant participant) {
        MediaCredentialsDTO media = null;
        if (participant != null
                && participant.getStatus() == ParticipantStatus.JOINED
                && meeting.getStatus() == MeetingStatus.IN_PROGRESS) {
            media = mediaTokenService.mintFor(meeting, participant);
        }
        MeetingDTO summary = MeetingDTO.summaryOf(meeting.getId(), meeting.getJoinCode(), meeting.getTitle(),
                meeting.getType(), meeting.getStatus(), meeting.isLocked(), meeting.getPasswordHash() != null,
                meeting.isWaitingRoomEnabled(), meeting.isMuteOnEntry(), meeting.getHost().getId(),
                meeting.getHost().getName(), meeting.getCreatedAt());
        return new MyMeetingStatusDTO(summary, participant == null ? null : toDto(participant), media);
    }

    private MeetingParticipant requireTarget(Meeting meeting, Long userId) {
        return participantRepo.findByMeetingIdAndUserId(meeting.getId(), userId)
                .orElseThrow(() -> new ConflictException("Participant not found in this meeting"));
    }

    private ParticipantDTO toDto(MeetingParticipant participant) {
        User admittedBy = participant.getAdmittedBy();
        return new ParticipantDTO(participant.getUser().getId(), participant.getUser().getName(),
                participant.getRole(), participant.getStatus(), participant.isMuted(), participant.isSpeaking(),
                participant.getJoinCount(), participant.getFirstJoinedAt(), participant.getLastJoinedAt(),
                participant.getLastLeftAt(), participant.getLastSpeakingAt(),
                admittedBy == null ? null : admittedBy.getName());
    }
}
