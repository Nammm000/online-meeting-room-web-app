package tech.getarrays.meetingroom.services.media;

import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.configuration.JanusProperties;
import tech.getarrays.meetingroom.configuration.LiveKitProperties;
import tech.getarrays.meetingroom.dto.meeting.MediaCredentialsDTO;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant;

/**
 * Composes the client's media credentials for both planes in one call. Minted
 * only after the DB says JOINED + IN_PROGRESS. The lazy {@code ensureRoom}
 * here is the self-healing path: if Janus lost the room (restart, failed
 * create at meeting start), the next admitted participant's token request
 * recreates it — same for the LiveKit room via ensureRoom on the video side.
 */
@Service
public class MediaTokenService {

    private final LiveKitMediaService liveKitMediaService;
    private final JanusAudioBridgeClient janusAudioBridgeClient;
    private final RoomSecretDeriver roomSecretDeriver;
    private final LiveKitProperties liveKitProperties;
    private final JanusProperties janusProperties;

    public MediaTokenService(LiveKitMediaService liveKitMediaService,
                             JanusAudioBridgeClient janusAudioBridgeClient,
                             RoomSecretDeriver roomSecretDeriver,
                             LiveKitProperties liveKitProperties,
                             JanusProperties janusProperties) {
        this.liveKitMediaService = liveKitMediaService;
        this.janusAudioBridgeClient = janusAudioBridgeClient;
        this.roomSecretDeriver = roomSecretDeriver;
        this.liveKitProperties = liveKitProperties;
        this.janusProperties = janusProperties;
    }

    public MediaCredentialsDTO mintFor(Meeting meeting, MeetingParticipant participant) {
        User user = participant.getUser();
        liveKitMediaService.ensureRoom(meeting.getJoinCode());
        janusAudioBridgeClient.ensureRoom(meeting.getId());
        // Publish grants derive from the DB on every mint — reconnects
        // self-heal whatever an entitlements call missed.
        boolean screenShareAllowed = meeting.getScreenSharer() != null
                && meeting.getScreenSharer().getId().equals(user.getId());
        return new MediaCredentialsDTO(
                liveKitProperties.url(),
                liveKitMediaService.mintToken(user.getId(), user.getName(), meeting.getJoinCode(),
                        participant.isVideoEnabled(), screenShareAllowed),
                janusProperties.wsUrl(),
                meeting.getId(),
                roomSecretDeriver.roomPin(meeting.getId()),
                participant.isMuted());
    }
}
