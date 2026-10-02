package tech.getarrays.meetingroom.configuration;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * {@code app.livekit.*} — must match docker/livekit/livekit.yaml. token-ttl
 * bounds a removed participant's reconnect window (tokens are also revoked
 * explicitly on remove/end, but the TTL covers a failed revocation call);
 * room-empty-timeout-seconds is the orphan-room backstop.
 */
@ConfigurationProperties("app.livekit")
public record LiveKitProperties(
        String url,
        String apiKey,
        String apiSecret,
        Duration tokenTtl,
        Integer roomEmptyTimeoutSeconds) {
}
