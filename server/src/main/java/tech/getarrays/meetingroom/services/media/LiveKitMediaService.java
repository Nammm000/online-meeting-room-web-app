package tech.getarrays.meetingroom.services.media;

import io.livekit.server.AccessToken;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanPublishSources;
import io.livekit.server.CanSubscribe;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import io.livekit.server.RoomServiceClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.configuration.LiveKitProperties;

import java.io.IOException;
import java.util.List;

/**
 * The Spring→LiveKit control surface (video SFU). Room name = the meeting's
 * join code (never the internal id); every room method is best-effort —
 * **never throws**, logs at WARN and returns false — so a LiveKit outage can
 * never fail a committed DB transition. Token TTL is short (default 5 min):
 * it bounds the reconnect window of a removed participant whose revocation
 * call failed.
 *
 * Video-only publishing is enforced server-side by the source allowlist
 * (camera + screen_share; microphone excluded) — the SDK has no separate
 * canPublishAudio grant, CanPublishSources supersedes it.
 */
@Slf4j
@Service
public class LiveKitMediaService {

    private static final List<String> PUBLISH_SOURCES = List.of("camera", "screen_share");

    private final RoomServiceClient roomServiceClient;
    private final LiveKitProperties properties;

    public LiveKitMediaService(RoomServiceClient roomServiceClient, LiveKitProperties properties) {
        this.roomServiceClient = roomServiceClient;
        this.properties = properties;
    }

    /**
     * Idempotent (LiveKit returns the existing room). emptyTimeout is the
     * orphan-room backstop when a deleteRoom call fails — bounded, so an
     * abandoned room self-cleans, but long enough to cover a lobby wait.
     */
    public boolean ensureRoom(String joinCode) {
        try {
            roomServiceClient.createRoom(joinCode, properties.roomEmptyTimeoutSeconds()).execute();
            return true;
        } catch (IOException e) {
            log.warn("LiveKit ensureRoom failed for {}: {}", joinCode, e.getMessage());
            return false;
        }
    }

    public boolean deleteRoom(String joinCode) {
        try {
            roomServiceClient.deleteRoom(joinCode).execute();
            return true;
        } catch (IOException e) {
            log.warn("LiveKit deleteRoom failed for {}: {}", joinCode, e.getMessage());
            return false;
        }
    }

    /** Disconnects the participant and revokes every token issued before now. */
    public boolean removeParticipant(String joinCode, Long userId) {
        try {
            roomServiceClient
                    .removeParticipant(joinCode, String.valueOf(userId), System.currentTimeMillis())
                    .execute();
            return true;
        } catch (IOException e) {
            log.warn("LiveKit removeParticipant failed for {}/user {}: {}", joinCode, userId, e.getMessage());
            return false;
        }
    }

    /** Short-TTL video-only access token; identity = users.id (what removeParticipant targets). */
    public String mintToken(Long userId, String displayName, String joinCode) {
        AccessToken token = new AccessToken(properties.apiKey(), properties.apiSecret());
        token.setIdentity(String.valueOf(userId));
        token.setName(displayName);
        token.setTtl(properties.tokenTtl().toMillis());
        token.addGrants(
                new RoomJoin(true),
                new RoomName(joinCode),
                new CanSubscribe(true),
                new CanPublishSources(PUBLISH_SOURCES),
                new CanPublishData(false));
        return token.toJwt();
    }
}
