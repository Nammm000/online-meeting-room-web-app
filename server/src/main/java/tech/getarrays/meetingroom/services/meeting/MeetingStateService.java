package tech.getarrays.meetingroom.services.meeting;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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

/**
 * Every multi-row DB transition of the meeting domain, each one transactional
 * (design-doc rules 1–6). The controller-facing services are deliberately NOT
 * transactional: they validate, call one of these methods, and only after it
 * returns — i.e. after commit — make best-effort media calls. Methods load
 * their rows inside the transaction so the writes hit managed entities.
 */
@Slf4j
@Service
public class MeetingStateService {

    private static final int JOIN_CODE_ATTEMPTS = 5;

    private final MeetingRepo meetingRepo;
    private final MeetingParticipantRepo participantRepo;
    private final JoinCodeGenerator joinCodeGenerator;
    private final PasswordEncoder passwordEncoder;

    public MeetingStateService(MeetingRepo meetingRepo,
                               MeetingParticipantRepo participantRepo,
                               JoinCodeGenerator joinCodeGenerator,
                               PasswordEncoder passwordEncoder) {
        this.meetingRepo = meetingRepo;
        this.participantRepo = participantRepo;
        this.joinCodeGenerator = joinCodeGenerator;
        this.passwordEncoder = passwordEncoder;
    }

    // ── meeting lifecycle ────────────────────────────────────────────────────

    /**
     * Rule 1: meeting row + the host's participant row in one transaction.
     * INSTANT is born IN_PROGRESS with the host JOINED; SCHEDULED is born
     * SCHEDULED with the host row in LEFT (joined-at-start semantics — the
     * explicit design decision recorded in the implementation notes).
     */
    @Transactional
    public Meeting createMeetingAndHost(User host, CreateMeetingRequest request) {
        Meeting meeting = Meeting.builder()
                .host(host)
                .title(request.title())
                .description(request.description())
                .type(request.type())
                .status(request.type() == MeetingType.INSTANT ? MeetingStatus.IN_PROGRESS : MeetingStatus.SCHEDULED)
                .scheduledStartAt(request.scheduledStartAt())
                .scheduledEndAt(request.scheduledEndAt())
                .waitingRoomEnabled(Boolean.TRUE.equals(request.waitingRoomEnabled()))
                .muteOnEntry(Boolean.TRUE.equals(request.muteOnEntry()))
                .passwordHash(request.password() == null || request.password().isBlank()
                        ? null : passwordEncoder.encode(request.password().trim()))
                .build();
        meeting = saveWithFreshJoinCode(meeting);

        MeetingParticipant hostRow = MeetingParticipant.builder()
                .meeting(meeting)
                .user(host)
                .role(ParticipantRole.HOST)
                .status(request.type() == MeetingType.INSTANT ? ParticipantStatus.JOINED : ParticipantStatus.LEFT)
                .muted(request.type() == MeetingType.INSTANT && Boolean.TRUE.equals(request.muteOnEntry()))
                .build();
        if (request.type() == MeetingType.INSTANT) {
            LocalDateTime now = LocalDateTime.now();
            hostRow.setFirstJoinedAt(now);
            hostRow.setLastJoinedAt(now);
            hostRow.setJoinCount(1);
        }
        participantRepo.save(hostRow);
        return meeting;
    }

    @Transactional
    public Meeting markStarted(Long meetingId) {
        Meeting meeting = requireMeeting(meetingId);
        meeting.setStatus(MeetingStatus.IN_PROGRESS);
        meeting.setActualStartAt(LocalDateTime.now());
        meetingRepo.save(meeting);

        // The host's row moves to JOINED on start (it was LEFT since creation).
        participantRepo.findByMeetingIdAndUserId(meetingId, meeting.getHost().getId())
                .ifPresent(host -> transitionToJoined(host, meeting.isMuteOnEntry() || host.isMuted()));
        return meeting;
    }

    /** Rule 4: status + ended_at, then the bulk JOINED → LEFT move, all in one transaction. */
    @Transactional
    public Meeting markEnded(Long meetingId) {
        Meeting meeting = requireMeeting(meetingId);
        LocalDateTime now = LocalDateTime.now();
        meeting.setStatus(MeetingStatus.ENDED);
        meeting.setEndedAt(now);
        meeting.setScreenSharer(null); // the share slot dies with the meeting
        meetingRepo.save(meeting);
        participantRepo.updateStatusForMeeting(meetingId, ParticipantStatus.JOINED, ParticipantStatus.LEFT, now);
        return meeting;
    }

    @Transactional
    public Meeting markCancelled(Long meetingId) {
        Meeting meeting = requireMeeting(meetingId);
        meeting.setStatus(MeetingStatus.CANCELLED);
        return meetingRepo.save(meeting);
    }

    // ── participation ────────────────────────────────────────────────────────

    /**
     * Join-or-rejoin state machine. One row per (meeting, user): WAITING when
     * the waiting room is on (or the user was removed/denied — forced lobby
     * re-request), JOINED otherwise; LEFT/DECLINED rejoin in place with
     * joinCount++; JOINED/WAITING are idempotent no-ops.
     */
    @Transactional
    public MeetingParticipant joinParticipant(Meeting meeting, User caller) {
        MeetingParticipant participant = participantRepo
                .findByMeetingIdAndUserId(meeting.getId(), caller.getId())
                .orElseGet(() -> MeetingParticipant.builder()
                        .meeting(meeting)
                        .user(caller)
                        .role(ParticipantRole.PARTICIPANT)
                        .status(ParticipantStatus.WAITING)
                        .build());

        boolean forcedLobby = participant.getStatus() == ParticipantStatus.REMOVED
                || participant.getStatus() == ParticipantStatus.DENIED;
        boolean hostRow = participant.getRole() == ParticipantRole.HOST;

        switch (participant.getStatus()) {
            case JOINED, WAITING -> { /* idempotent */ }
            case LEFT, DECLINED -> transitionToJoined(participant, meeting.isMuteOnEntry() || participant.isMuted());
            case REMOVED, DENIED -> participant.setStatus(ParticipantStatus.WAITING);
        }
        if (participant.getStatus() == ParticipantStatus.WAITING && !forcedLobby && !hostRow
                && !meeting.isWaitingRoomEnabled()) {
            transitionToJoined(participant, meeting.isMuteOnEntry() || participant.isMuted());
        }
        return participantRepo.save(participant);
    }

    /** Rule (admit): WAITING → JOINED with admitted_by, join bookkeeping, and mute-on-entry. */
    @Transactional
    public MeetingParticipant admit(Long meetingId, Long userId, User admittedBy) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        if (participant.getStatus() != ParticipantStatus.WAITING) {
            throw new ConflictException("Participant is not in the waiting room");
        }
        participant.setAdmittedBy(admittedBy);
        transitionToJoined(participant, requireMeeting(meetingId).isMuteOnEntry() || participant.isMuted());
        return participantRepo.save(participant);
    }

    @Transactional
    public MeetingParticipant deny(Long meetingId, Long userId) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        if (participant.getStatus() != ParticipantStatus.WAITING) {
            throw new ConflictException("Participant is not in the waiting room");
        }
        participant.setStatus(ParticipantStatus.DENIED);
        return participantRepo.save(participant);
    }

    /** Host "remove participant": JOINED/WAITING → REMOVED (host re-admit happens via forced lobby). */
    @Transactional
    public MeetingParticipant remove(Long meetingId, Long userId) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        if (participant.getStatus() == ParticipantStatus.JOINED || participant.getStatus() == ParticipantStatus.WAITING) {
            participant.setStatus(ParticipantStatus.REMOVED);
            participant.setLastLeftAt(LocalDateTime.now());
            participant.setSpeaking(false);
            participant.setHandRaised(false);
            meetingRepo.releaseScreenSharerIf(meetingId, userId);
        }
        return participantRepo.save(participant);
    }

    /** Idempotent self-leave + the webhook path (participant_left): only JOINED rows move. */
    @Transactional
    public void markLeftIfJoined(Long meetingId, Long userId) {
        participantRepo.findByMeetingIdAndUserId(meetingId, userId)
                .filter(p -> p.getStatus() == ParticipantStatus.JOINED)
                .ifPresent(participant -> {
                    participant.setStatus(ParticipantStatus.LEFT);
                    participant.setLastLeftAt(LocalDateTime.now());
                    participant.setSpeaking(false);
                    participant.setHandRaised(false);
                    participantRepo.save(participant);
                    meetingRepo.releaseScreenSharerIf(meetingId, userId);
                });
    }

    @Transactional
    public void setMuted(Long meetingId, Long userId, boolean muted) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        participant.setMuted(muted);
        if (muted) {
            participant.setSpeaking(false); // a muted mic cannot speak — the clamp contract
        }
        participantRepo.save(participant);
    }

    /** Self speaking state from the client's local mic analysis; lastSpeakingAt stamps only the rising edge. */
    @Transactional
    public void setSpeaking(Long meetingId, Long userId, boolean speaking) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        if (speaking && !participant.isSpeaking()) {
            participant.setLastSpeakingAt(LocalDateTime.now());
        }
        participant.setSpeaking(speaking);
        participantRepo.save(participant);
    }

    /** Raised-hand state; lastHandRaisedAt stamps only the rising edge. */
    @Transactional
    public void setHandRaised(Long meetingId, Long userId, boolean handRaised) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        if (handRaised && !participant.isHandRaised()) {
            participant.setLastHandRaisedAt(LocalDateTime.now());
        }
        participant.setHandRaised(handRaised);
        participantRepo.save(participant);
    }

    /** Camera entitlement — persists across rejoin like {@code muted} (no reset in transitionToJoined). */
    @Transactional
    public void setVideoEnabled(Long meetingId, Long userId, boolean videoEnabled) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        participant.setVideoEnabled(videoEnabled);
        participantRepo.save(participant);
    }

    /**
     * Claims the exclusive screen-share slot atomically. False = someone else
     * holds it (the caller renders the 409); re-claiming by the current sharer
     * is idempotently true.
     */
    @Transactional
    public boolean claimScreenShare(Long meetingId, Long userId) {
        return meetingRepo.claimScreenSharerIfFree(meetingId, userId) > 0;
    }

    /** Releases the share slot iff this user holds it — idempotent, rowcount ignored. */
    @Transactional
    public void releaseScreenShare(Long meetingId, Long userId) {
        meetingRepo.releaseScreenSharerIf(meetingId, userId);
    }

    @Transactional
    public void setLocked(Long meetingId, boolean locked) {
        Meeting meeting = requireMeeting(meetingId);
        meeting.setLocked(locked);
        meetingRepo.save(meeting);
    }

    @Transactional
    public void setRole(Long meetingId, Long userId, ParticipantRole role) {
        MeetingParticipant participant = requireParticipant(meetingId, userId);
        if (participant.getRole() == ParticipantRole.HOST) {
            throw new ConflictException("The host role is immutable");
        }
        if (role == ParticipantRole.HOST) {
            throw new ConflictException("Cannot promote a participant to host");
        }
        participant.setRole(role);
        participantRepo.save(participant);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void transitionToJoined(MeetingParticipant participant, boolean muted) {
        LocalDateTime now = LocalDateTime.now();
        if (participant.getFirstJoinedAt() == null) {
            participant.setFirstJoinedAt(now);
        }
        participant.setLastJoinedAt(now);
        participant.setJoinCount(participant.getJoinCount() + 1);
        participant.setMuted(muted);
        participant.setSpeaking(false); // rejoin/admit hygiene — a stale flag must not survive a session gap
        participant.setHandRaised(false);
        participant.setStatus(ParticipantStatus.JOINED);
    }

    private Meeting requireMeeting(Long meetingId) {
        return meetingRepo.findById(meetingId)
                .orElseThrow(() -> new ConflictException("Meeting no longer exists"));
    }

    private MeetingParticipant requireParticipant(Long meetingId, Long userId) {
        return participantRepo.findByMeetingIdAndUserId(meetingId, userId)
                .orElseThrow(() -> new ConflictException("Participant not found in this meeting"));
    }

    private Meeting saveWithFreshJoinCode(Meeting meeting) {
        DataIntegrityViolationException last = null;
        for (int attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt++) {
            meeting.setJoinCode(joinCodeGenerator.generate());
            try {
                return meetingRepo.save(meeting);
            } catch (DataIntegrityViolationException e) {
                last = e; // join-code collision against the unique constraint — regenerate
                log.debug("Join code collision on attempt {}: {}", attempt + 1, e.getMessage());
            }
        }
        throw last;
    }
}
