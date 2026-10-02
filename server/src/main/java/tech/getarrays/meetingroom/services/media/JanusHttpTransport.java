package tech.getarrays.meetingroom.services.media;

import java.util.Map;

/**
 * The one seam between the app and Janus's HTTP API ({@code POST} only —
 * every AudioBridge admin request is synchronous). Paths are appended to the
 * configured base ({@code app.janus.http-url}): {@code ""} creates a session,
 * {@code /<sessionId>} attaches/destroys, {@code /<sessionId>/<handleId>}
 * carries plugin messages. Exists as an interface so unit tests stub one
 * method instead of a real HTTP server.
 */
public interface JanusHttpTransport {

    /**
     * @return the decoded Janus response envelope ({@code janus}, {@code data}, ...)
     * @throws org.springframework.web.client.RestClientException on transport failure
     */
    Map<String, Object> post(String path, Map<String, Object> body);
}
