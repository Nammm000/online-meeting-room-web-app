package tech.getarrays.meetingroom.services.media;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.configuration.JanusProperties;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The Spring→Janus AudioBridge control surface (audio MCU). Every operation
 * runs its own ephemeral HTTP session — create → attach {@code
 * janus.plugin.audiobridge} → message → destroy — which costs three round
 * trips but keeps the client stateless (sessions time out after 60 s anyway).
 * Every method is best-effort: **never throws**, logs at WARN and returns
 * false, so a Janus outage can never roll back or fail a committed DB
 * transition (the "DB first, media best-effort" invariant). A lost room
 * self-heals on the next {@link #ensureRoom} call.
 *
 * Room keying: AudioBridge room id = numeric {@code meetings.id}; browser
 * participants join directly over the WebSocket transport with {@code
 * id = users.id} + the room pin, so admin ops below target users by id with
 * no lookup. Contract: docs/meeting-media-architecture.md §4.2/§5.
 */
@Slf4j
@Service
public class JanusAudioBridgeClient {

    private static final String PLUGIN = "janus.plugin.audiobridge";

    private final JanusHttpTransport transport;
    private final JanusProperties properties;
    private final RoomSecretDeriver secretDeriver;

    public JanusAudioBridgeClient(JanusHttpTransport transport,
                                  JanusProperties properties,
                                  RoomSecretDeriver secretDeriver) {
        this.transport = transport;
        this.properties = properties;
        this.secretDeriver = secretDeriver;
    }

    /** Idempotent: skips creation when the room already exists (Janus restart safe). */
    public boolean ensureRoom(Long meetingId) {
        try {
            if (roomExists(meetingId)) {
                return true;
            }
            Map<String, Object> body = adminBody(meetingId, "create");
            body.put("room", meetingId);
            body.put("pin", secretDeriver.roomPin(meetingId));
            body.put("sampling_rate", properties.samplingRate());
            body.put("description", "meeting-" + meetingId);
            body.put("permanent", false);
            return sendPluginRequest(body, "created");
        } catch (Exception e) {
            log.warn("AudioBridge ensureRoom failed for meeting {}: {}", meetingId, e.getMessage());
            return false;
        }
    }

    public boolean destroyRoom(Long meetingId) {
        try {
            Map<String, Object> body = adminBody(meetingId, "destroy");
            body.put("room", meetingId);
            return sendPluginRequest(body, "destroyed");
        } catch (Exception e) {
            log.warn("AudioBridge destroyRoom failed for meeting {}: {}", meetingId, e.getMessage());
            return false;
        }
    }

    /**
     * Host-mute enforcement: the mix drops the feeder server-side, so the
     * muted client cannot just republish. The DB {@code muted} column is the
     * rejoin-surviving record of this.
     */
    public boolean adminMute(Long meetingId, Long userId, boolean mute) {
        try {
            Map<String, Object> body = adminBody(meetingId, mute ? "mute" : "unmute");
            body.put("room", meetingId);
            body.put("id", userId);
            return sendPluginRequest(body, "success");
        } catch (Exception e) {
            log.warn("AudioBridge adminMute({}) failed for meeting {}/user {}: {}",
                    mute, meetingId, userId, e.getMessage());
            return false;
        }
    }

    /** Remove a participant from the bridge entirely (host "remove participant"). */
    public boolean kick(Long meetingId, Long userId) {
        try {
            Map<String, Object> body = adminBody(meetingId, "kick");
            body.put("room", meetingId);
            body.put("id", userId);
            return sendPluginRequest(body, "success");
        } catch (Exception e) {
            log.warn("AudioBridge kick failed for meeting {}/user {}: {}", meetingId, userId, e.getMessage());
            return false;
        }
    }

    public boolean roomExists(Long meetingId) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("request", "exists");
            body.put("room", meetingId);
            Map<String, Object> data = sendPluginRequest(body);
            return data != null && Boolean.TRUE.equals(data.get("exists"));
        } catch (Exception e) {
            log.warn("AudioBridge exists check failed for meeting {}: {}", meetingId, e.getMessage());
            return false;
        }
    }

    // ── plumbing ─────────────────────────────────────────────────────────────

    /** Admin body base: room secret (admin ops) + plugin admin_key (room create). */
    private Map<String, Object> adminBody(Long meetingId, String request) {
        Map<String, Object> body = new HashMap<>();
        body.put("request", request);
        body.put("secret", secretDeriver.roomSecret(meetingId));
        body.put("admin_key", properties.adminKey());
        return body;
    }

    /** Runs one message through an ephemeral session; returns {@code plugindata.data} or null. */
    private Map<String, Object> sendPluginRequest(Map<String, Object> pluginBody) {
        Map<String, Object> session = transport.post("", envelope("create"));
        Long sessionId = nestedId(session, "data");
        if (sessionId == null) {
            log.warn("Janus session creation failed: {}", session);
            return null;
        }
        try {
            Map<String, Object> attach = new HashMap<>(envelope("attach"));
            attach.put("plugin", PLUGIN);
            Map<String, Object> attached = transport.post("/" + sessionId, attach);
            Long handleId = nestedId(attached, "data");
            if (handleId == null) {
                log.warn("Janus attach failed: {}", attached);
                return null;
            }
            Map<String, Object> message = new HashMap<>(envelope("message"));
            message.put("body", pluginBody);
            Map<String, Object> response = transport.post("/" + sessionId + "/" + handleId, message);
            if (!"success".equals(response.get("janus"))) {
                // Synchronous plugin requests come back on the POST response; an "ack"
                // means the plugin answers asynchronously — every op we use is sync.
                log.warn("Janus message not successful (async ack not expected here): {}", response);
                return null;
            }
            Map<String, Object> plugindata = castMap(response.get("plugindata"));
            return plugindata == null ? null : castMap(plugindata.get("data"));
        } finally {
            try {
                transport.post("/" + sessionId, envelope("destroy"));
            } catch (Exception e) {
                log.debug("Janus session destroy failed (harmless, 60s timeout reaps it): {}", e.getMessage());
            }
        }
    }

    /** Sends a request and additionally checks the plugin's own status word. */
    private boolean sendPluginRequest(Map<String, Object> pluginBody, String expectedStatus) {
        Map<String, Object> data = sendPluginRequest(pluginBody);
        boolean ok = data != null && expectedStatus.equals(data.get("audiobridge"));
        if (!ok) {
            log.warn("AudioBridge request {} did not return '{}' (data: {})",
                    pluginBody.get("request"), expectedStatus, data);
        }
        return ok;
    }

    private static Map<String, Object> envelope(String janus) {
        Map<String, Object> body = new HashMap<>();
        body.put("janus", janus);
        body.put("transaction", UUID.randomUUID());
        return body;
    }

    private static Long nestedId(Map<String, Object> response, String key) {
        Map<String, Object> data = response == null ? null : castMap(response.get(key));
        Object id = data == null ? null : data.get("id");
        return id instanceof Number number ? number.longValue() : null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : null;
    }
}
