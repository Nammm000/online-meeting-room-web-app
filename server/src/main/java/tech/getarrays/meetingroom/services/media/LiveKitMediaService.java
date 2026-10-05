package tech.getarrays.meetingroom.services.media;

import io.livekit.server.AccessToken;
import io.livekit.server.CanPublish;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanPublishSources;
import io.livekit.server.CanSubscribe;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
import livekit.LivekitModels.ParticipantPermission;
import livekit.LivekitModels.TrackSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.configuration.LiveKitProperties;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * The Spring→LiveKit control surface (video SFU). Room name = the meeting's
 * join code (never the internal id); every room method is best-effort —
 * **never throws**, logs at WARN and returns false — so a LiveKit outage can
 * never fail a committed DB transition. Token TTL is short (default 5 min):
 * it bounds the reconnect window of a removed participant whose revocation
 * call failed.
 *
 * Video-only track publishing is enforced server-side by the source
 * allowlist (camera / screen_share per entitlement; microphone always
 * excluded — the SDK has no separate canPublishAudio grant,
 * CanPublishSources supersedes it). Data-channel publishing is granted to
 * every participant for the ephemeral emoji reactions only (chat stays
 * DB-owned). Token grants bind at connect time only; live-session
 * permission changes go through {@link #applyPublishEntitlements}
 * (updateParticipant), and the DB-derived grants on every re-mint
 * self-heal reconnects.
 */
@Slf4j
@Service
public class LiveKitMediaService {

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

    /**
     * Updates a LIVE session's publish rights (token grants bind only at
     * connect). Participant offline → IOException → WARN + false: the DB flag
     * still commits and the next minted token carries the restriction —
     * the same best-effort contract as a host-mute before bridge join.
     */
    public boolean applyPublishEntitlements(String joinCode, Long userId,
                                            boolean cameraAllowed, boolean screenShareAllowed) {
        try {
            List<TrackSource> sources = new ArrayList<>();
            if (cameraAllowed) {
                sources.add(TrackSource.CAMERA);
            }
            if (screenShareAllowed) {
                sources.add(TrackSource.SCREEN_SHARE);
            }
            ParticipantPermission permission = ParticipantPermission.newBuilder()
                    .setCanSubscribe(true)
                    .setCanPublish(!sources.isEmpty())
                    // Data stays on — reactions keep flowing across entitlement pushes.
                    .setCanPublishData(true)
                    .addAllCanPublishSources(sources)
                    .build();
            roomServiceClient.updateParticipant(joinCode, String.valueOf(userId), null, null, permission).execute();
            return true;
        } catch (IOException e) {
            log.warn("LiveKit applyPublishEntitlements failed for {}/user {}: {}", joinCode, userId, e.getMessage());
            return false;
        }
    }

    /**
     * Short-TTL access token; identity = users.id (what
     * removeParticipant targets). Publish sources are per-entitlement: an
     * empty allowlist would mean ALL sources in LiveKit, so the fully
     * restricted participant gets a hard {@code canPublish=false} instead.
     * Data-channel publishing (emoji reactions) is granted unconditionally.
     */
    public String mintToken(Long userId, String displayName, String joinCode,
                            boolean cameraAllowed, boolean screenShareAllowed) {
        AccessToken token = new AccessToken(properties.apiKey(), properties.apiSecret());
        token.setIdentity(String.valueOf(userId));
        token.setName(displayName);
        token.setTtl(properties.tokenTtl().toMillis());
        List<String> sources = new ArrayList<>();
        if (cameraAllowed) {
            sources.add("camera");
        }
        if (screenShareAllowed) {
            sources.add("screen_share");
        }
        if (sources.isEmpty()) {
            token.addGrants(
                    new RoomJoin(true),
                    new RoomName(joinCode),
                    new CanSubscribe(true),
                    new CanPublish(false),
                    new CanPublishData(true));
        } else {
            token.addGrants(
                    new RoomJoin(true),
                    new RoomName(joinCode),
                    new CanSubscribe(true),
                    new CanPublishSources(List.copyOf(sources)),
                    new CanPublishData(true));
        }
        return token.toJwt();
    }
}
