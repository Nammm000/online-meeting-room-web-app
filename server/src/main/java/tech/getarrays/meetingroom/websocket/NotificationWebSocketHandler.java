package tech.getarrays.meetingroom.websocket;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tech.getarrays.meetingroom.dto.NotificationDTO;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Holds every open /ws/notifications session and pushes broadcasts to them.
 * One frame every 30 minutes per session — no send-time buffering needed,
 * just per-session synchronization so concurrent sends can't interleave.
 */
@Slf4j
@Component
public class NotificationWebSocketHandler extends TextWebSocketHandler {

    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();

    private ObjectMapper objectMapper;

    @Autowired
    public NotificationWebSocketHandler(ObjectMapper theObjectMapper) {
        this.objectMapper = theObjectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        log.debug("Notification session opened: {} ({} connected)", session.getId(), sessions.size());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) {
        sessions.remove(session);
        log.debug("Notification session closed: {} ({} connected)", session.getId(), sessions.size());
    }

    /**
     * Sends the notification to every open session. Cheap no-op when nobody is
     * connected (the scheduler fires every 30 minutes regardless).
     */
    public void broadcast(NotificationDTO notification) {
        if (sessions.isEmpty()) {
            return;
        }
        final String json;
        try {
            json = objectMapper.writeValueAsString(notification);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize notification {}", notification, e);
            return;
        }
        for (WebSocketSession session : sessions) {
            if (!session.isOpen()) {
                sessions.remove(session);
                continue;
            }
            try {
                synchronized (session) {
                    session.sendMessage(new TextMessage(json));
                }
            } catch (IOException e) {
                log.warn("Notification send failed for session {} — evicting", session.getId(), e);
                sessions.remove(session);
                try {
                    session.close();
                } catch (IOException ignored) {
                    // already broken
                }
            }
        }
    }

    int sessionCount() {
        return sessions.size();
    }
}
