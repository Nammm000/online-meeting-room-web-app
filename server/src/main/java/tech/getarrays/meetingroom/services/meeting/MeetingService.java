package tech.getarrays.meetingroom.services.meeting;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.dto.PagedResponseDTO;
import tech.getarrays.meetingroom.dto.meeting.CreateMeetingRequest;
import tech.getarrays.meetingroom.dto.meeting.MediaCredentialsDTO;
import tech.getarrays.meetingroom.dto.meeting.MeetingDTO;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingType;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.services.media.JanusAudioBridgeClient;
import tech.getarrays.meetingroom.services.media.LiveKitMediaService;
import tech.getarrays.meetingroom.services.media.MediaTokenService;
import tech.getarrays.meetingroom.util.UserUtils;

import java.util.List;
import java.util.Objects;

/**
 * Meeting lifecycle orchestration — deliberately NOT @Transactional: each
 * flow validates, commits its DB transition via {@link MeetingStateService},
 * and only then makes best-effort media calls (create/start → ensure both
 * rooms; end → tear both down). A media failure leaves the meeting valid;
 * the lazy ensureRoom at the next token mint self-heals a missing room.
 */
@Service
public class MeetingService {

    private final MeetingRepo meetingRepo;
    private final MeetingParticipantRepo participantRepo;
    private final MeetingAuthority authority;
    private final MeetingStateService stateService;
    private final LiveKitMediaService liveKitMediaService;
    private final JanusAudioBridgeClient janusAudioBridgeClient;
    private final MediaTokenService mediaTokenService;

    public MeetingService(MeetingRepo meetingRepo,
                          MeetingParticipantRepo participantRepo,
                          MeetingAuthority authority,
                          MeetingStateService stateService,
                          LiveKitMediaService liveKitMediaService,
                          JanusAudioBridgeClient janusAudioBridgeClient,
                          MediaTokenService mediaTokenService) {
        this.meetingRepo = meetingRepo;
        this.participantRepo = participantRepo;
        this.authority = authority;
        this.stateService = stateService;
        this.liveKitMediaService = liveKitMediaService;
        this.janusAudioBridgeClient = janusAudioBridgeClient;
        this.mediaTokenService = mediaTokenService;
    }

    public MeetingDTO create(CreateMeetingRequest request) {
        validate(request);
        User caller = UserUtils.getCurrentUser();
        Meeting meeting = stateService.createMeetingAndHost(caller, request);
        if (meeting.getType() == MeetingType.INSTANT) {
            ensureMediaRooms(meeting);
            return toDtoWithHostMedia(meeting, caller);
        }
        return toDto(meeting);
    }

    public PagedResponseDTO<MeetingDTO> myMeetings(int page, int size) {
        User caller = UserUtils.getCurrentUser();
        Page<Meeting> meetings = meetingRepo.findByHostId(caller.getId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        List<MeetingDTO> content = meetings.stream().map(this::toDto).toList();
        return PagedResponseDTO.from(new PageImpl<>(content, meetings.getPageable(), meetings.getTotalElements()));
    }

    /** Pre-join screen metadata — no media, resolved strictly by join code. */
    public MeetingDTO getByJoinCode(String joinCode) {
        return toDto(authority.requireMeetingByJoinCode(joinCode));
    }

    public MeetingDTO start(Long meetingId) {
        Meeting meeting = authority.requireMeetingById(meetingId);
        authority.requireMeetingHost(meeting, UserUtils.getCurrentUser());
        authority.requireStatus(meeting, MeetingStatus.SCHEDULED);
        meeting = stateService.markStarted(meetingId);
        ensureMediaRooms(meeting);
        return toDtoWithHostMedia(meeting, UserUtils.getCurrentUser());
    }

    public MeetingDTO cancel(Long meetingId) {
        Meeting meeting = authority.requireMeetingById(meetingId);
        authority.requireMeetingHost(meeting, UserUtils.getCurrentUser());
        authority.requireStatus(meeting, MeetingStatus.SCHEDULED);
        return toDto(stateService.markCancelled(meetingId));
    }

    public MeetingDTO end(Long meetingId) {
        Meeting meeting = authority.requireMeetingById(meetingId);
        authority.requireMeetingHost(meeting, UserUtils.getCurrentUser());
        authority.requireStatus(meeting, MeetingStatus.IN_PROGRESS);
        meeting = stateService.markEnded(meetingId); // commits ENDED + bulk JOINED→LEFT
        liveKitMediaService.deleteRoom(meeting.getJoinCode()); // best-effort; emptyTimeout backstops
        janusAudioBridgeClient.destroyRoom(meeting.getId());
        return toDto(meeting);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void ensureMediaRooms(Meeting meeting) {
        liveKitMediaService.ensureRoom(meeting.getJoinCode());
        janusAudioBridgeClient.ensureRoom(meeting.getId());
    }

    private void validate(CreateMeetingRequest request) {
        if (request.title() == null || request.title().isBlank()) {
            throw new IllegalArgumentException("Title is required");
        }
        if (request.type() == null) {
            throw new IllegalArgumentException("Meeting type is required");
        }
        if (request.type() == MeetingType.SCHEDULED) {
            if (request.scheduledStartAt() == null || request.scheduledEndAt() == null) {
                throw new IllegalArgumentException("Scheduled meetings require a start and end time");
            }
            if (!request.scheduledEndAt().isAfter(request.scheduledStartAt())) {
                throw new IllegalArgumentException("Scheduled end must be after the start");
            }
        } else if (request.scheduledStartAt() != null || request.scheduledEndAt() != null) {
            throw new IllegalArgumentException("Instant meetings cannot carry a schedule");
        }
    }

    /** Host media in the create/start response — only while host JOINED + IN_PROGRESS. */
    private MeetingDTO toDtoWithHostMedia(Meeting meeting, User caller) {
        MediaCredentialsDTO media = participantRepo
                .findByMeetingIdAndUserId(meeting.getId(), caller.getId())
                .filter(p -> p.getStatus() == ParticipantStatus.JOINED)
                .filter(p -> meeting.getStatus() == MeetingStatus.IN_PROGRESS)
                .map(p -> mediaTokenService.mintFor(meeting, p))
                .orElse(null);
        return new MeetingDTO(meeting.getId(), meeting.getJoinCode(), meeting.getTitle(), meeting.getDescription(),
                meeting.getType(), meeting.getStatus(), meeting.getScheduledStartAt(), meeting.getScheduledEndAt(),
                meeting.getActualStartAt(), meeting.getEndedAt(), meeting.getCreatedAt(), meeting.isWaitingRoomEnabled(),
                meeting.isMuteOnEntry(), meeting.isLocked(), meeting.getHost().getId(), meeting.getHost().getName(),
                Objects.requireNonNull(media, "host media expected after create/start"));
    }

    private MeetingDTO toDto(Meeting meeting) {
        return new MeetingDTO(meeting.getId(), meeting.getJoinCode(), meeting.getTitle(), meeting.getDescription(),
                meeting.getType(), meeting.getStatus(), meeting.getScheduledStartAt(), meeting.getScheduledEndAt(),
                meeting.getActualStartAt(), meeting.getEndedAt(), meeting.getCreatedAt(), meeting.isWaitingRoomEnabled(),
                meeting.isMuteOnEntry(), meeting.isLocked(), meeting.getHost().getId(), meeting.getHost().getName(),
                null);
    }
}
