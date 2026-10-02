package tech.getarrays.meetingroom.websocket;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.util.Arrays;

/**
 * Raw WebSocket endpoint (no STOMP/SockJS — the client uses the browser-native
 * API and only listens). setAllowedOrigins is the WebSocket equivalent of CORS:
 * exact origins from app.client.url (same property the CORS bean consumes),
 * never "*" since the handshake carries the JWT credential in the query string.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfiguration implements WebSocketConfigurer {

    private NotificationWebSocketHandler notificationWebSocketHandler;

    private WebSocketAuthInterceptor webSocketAuthInterceptor;

    private String clientUrl;

    @Autowired
    public WebSocketConfiguration(NotificationWebSocketHandler theNotificationWebSocketHandler,
                                  WebSocketAuthInterceptor theWebSocketAuthInterceptor,
                                  @Value("${app.client.url}") String theClientUrl) {
        this.notificationWebSocketHandler = theNotificationWebSocketHandler;
        this.webSocketAuthInterceptor = theWebSocketAuthInterceptor;
        this.clientUrl = theClientUrl;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(notificationWebSocketHandler, "/ws/notifications")
                .addInterceptors(webSocketAuthInterceptor)
                .setAllowedOrigins(resolveOrigins());
    }

    /** Comma-separated exact origins, tolerating the legacy trailing "/*" — same parsing as the CORS bean. */
    private String[] resolveOrigins() {
        return Arrays.stream(clientUrl.split(","))
                .map(String::trim)
                .map(url -> url.endsWith("/*") ? url.substring(0, url.length() - 2) : url)
                .toArray(String[]::new);
    }
}
