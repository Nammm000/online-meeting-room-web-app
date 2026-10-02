package tech.getarrays.meetingroom.configuration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code app.janus.*} — http-url is the Spring control channel (admin API on
 * the HTTP transport), ws-url is what browsers receive in their media
 * credentials. admin-key must equal the AudioBridge jcfg; room-secret-pepper
 * seeds the deterministic per-room secret/pin derivation.
 */
@ConfigurationProperties("app.janus")
public record JanusProperties(
        String httpUrl,
        String wsUrl,
        String adminKey,
        String roomSecretPepper,
        Integer samplingRate) {
}
