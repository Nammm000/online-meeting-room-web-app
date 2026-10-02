package tech.getarrays.meetingroom.services.meeting;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;
import tech.getarrays.meetingroom.exception.ConflictException;
import tech.getarrays.meetingroom.exception.NotFoundException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.MeetingRepo;

import java.util.Optional;

/**
 * The stateless guard implementing the permission table from
 * docs/meeting-database-design.md §3: HOST — admit/deny, remove,
 * promote/demote, mute others, lock, end · COHOST — admit/deny, remove (not
 * HOST/COHOST), mute others · PARTICIPANT — self only. Reused by every
 * meeting service so authority lives in exactly one place.
 */
@Component
public class MeetingAuthority {

    private final MeetingRepo meetingRepo;
    private final MeetingParticipantRepo participantRepo;

    public MeetingAuthority(MeetingRepo meetingRepo, MeetingParticipantRepo participantRepo) {
        this.meetingRepo = meetingRepo;
        this.participantRepo = participantRepo;
    }

    /** Join-link resolution — always by join code, never by internal id. */
    public Meeting requireMeetingByJoinCode(String joinCode) {
        return meetingRepo.findByJoinCode(joinCode)
                .orElseThrow(() -> new NotFoundException("Meeting not found"));
    }

    public Meeting requireMeetingById(Long meetingId) {
        return meetingRepo.findById(meetingId)
                .orElseThrow(() -> new NotFoundException("Meeting not found"));
    }

    public void requireStatus(Meeting meeting, MeetingStatus status) {
        if (meeting.getStatus() != status) {
            throw new ConflictException("Meeting is not " + status);
        }
    }

    public void requireNotLocked(Meeting meeting) {
        if (meeting.isLocked()) {
            throw new ConflictException("Meeting is locked");
        }
    }

    /** The caller's participant row, if they have ever touched the meeting (null otherwise). */
    public Optional<MeetingParticipant> callerParticipant(Meeting meeting, User caller) {
        return participantRepo.findByMeetingIdAndUserId(meeting.getId(), caller.getId());
    }

    public MeetingParticipant requireAnyParticipant(Meeting meeting, User caller) {
        return callerParticipant(meeting, caller)
                .orElseThrow(() -> new AccessDeniedException("You are not a participant of this meeting"));
    }

    public MeetingParticipant requireJoined(Meeting meeting, User caller) {
        MeetingParticipant participant = requireAnyParticipant(meeting, caller);
        if (participant.getStatus() != MeetingParticipant.ParticipantStatus.JOINED) {
            throw new AccessDeniedException("You are not joined to this meeting");
        }
        return participant;
    }

    public MeetingParticipant requireHostOrCohost(Meeting meeting, User caller) {
        MeetingParticipant participant = requireAnyParticipant(meeting, caller);
        if (participant.getRole() != MeetingParticipant.ParticipantRole.HOST
                && participant.getRole() != MeetingParticipant.ParticipantRole.COHOST) {
            throw new AccessDeniedException("Host or co-host role required");
        }
        return participant;
    }

    public MeetingParticipant requireHost(Meeting meeting, User caller) {
        MeetingParticipant participant = requireAnyParticipant(meeting, caller);
        if (participant.getRole() != MeetingParticipant.ParticipantRole.HOST) {
            throw new AccessDeniedException("Host role required");
        }
        return participant;
    }

    /** Hosts are identified by the denormalized host_id column (single-table ownership checks). */
    public void requireMeetingHost(Meeting meeting, User caller) {
        if (!meeting.getHost().getId().equals(caller.getId())) {
            throw new AccessDeniedException("Only the meeting host may do this");
        }
    }
}
