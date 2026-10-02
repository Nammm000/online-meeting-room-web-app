package tech.getarrays.meetingroom.services.media;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tech.getarrays.meetingroom.configuration.JanusProperties;

import java.util.Map;

/**
 * {@link JanusHttpTransport} over Spring's {@link RestClient}, pointed at
 * {@code app.janus.http-url}. No timeouts tuned on purpose at dev scale; a
 * Janus outage surfaces as a RestClientException which
 * {@link JanusAudioBridgeClient} logs and swallows.
 */
@Component
public class JanusRestHttpTransport implements JanusHttpTransport {

    private final RestClient restClient;

    public JanusRestHttpTransport(JanusProperties janusProperties) {
        this.restClient = RestClient.builder().baseUrl(janusProperties.httpUrl()).build();
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> post(String path, Map<String, Object> body) {
        return restClient.post()
                .uri(path)
                .body(body)
                .retrieve()
                .body(Map.class);
    }
}
