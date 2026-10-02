package tech.getarrays.meetingroom.configuration;

import io.livekit.server.RoomServiceClient;
import io.livekit.server.WebhookReceiver;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Media-plane beans: the LiveKit admin client (rooms, participant removal)
 * and the webhook verifier (JWT signature + body sha256). Both hold the API
 * key/secret — nothing else in the app may.
 */
@Configuration
@EnableConfigurationProperties({LiveKitProperties.class, JanusProperties.class})
public class MediaConfiguration {

    @Bean
    public RoomServiceClient roomServiceClient(LiveKitProperties properties) {
        return RoomServiceClient.createClient(properties.url(), properties.apiKey(), properties.apiSecret());
    }

    @Bean
    public WebhookReceiver liveKitWebhookReceiver(LiveKitProperties properties) {
        return new WebhookReceiver(properties.apiKey(), properties.apiSecret());
    }
}
