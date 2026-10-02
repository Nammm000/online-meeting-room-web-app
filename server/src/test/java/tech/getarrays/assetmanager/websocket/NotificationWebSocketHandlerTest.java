package tech.getarrays.meetingroom.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tech.getarrays.meetingroom.dto.NotificationDTO;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationWebSocketHandlerTest {

    @Mock
    private WebSocketSession openSession;

    @Mock
    private WebSocketSession secondOpenSession;

    @Mock
    private WebSocketSession closedSession;

    private NotificationWebSocketHandler handlerWithSessions(WebSocketSession... sessions) {
        NotificationWebSocketHandler handler = new NotificationWebSocketHandler(new ObjectMapper());
        for (WebSocketSession session : sessions) {
            handler.afterConnectionEstablished(session);
        }
        return handler;
    }

    @Test
    void broadcastSendsTheSerializedNotificationToEveryOpenSession() throws IOException {
        when(openSession.isOpen()).thenReturn(true);
        when(secondOpenSession.isOpen()).thenReturn(true);
        NotificationWebSocketHandler handler = handlerWithSessions(openSession, secondOpenSession);

        handler.broadcast(new NotificationDTO("Reminder: please review your assets.", "2026-09-12T08:30:00Z"));

        for (WebSocketSession session : List.of(openSession, secondOpenSession)) {
            ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
            verify(session).sendMessage(captor.capture());
            assertThat(captor.getValue().getPayload())
                    .contains("\"message\":\"Reminder: please review your assets.\"")
                    .contains("\"timestamp\":\"2026-09-12T08:30:00Z\"");
        }
    }

    @Test
    void broadcastSkipsClosedSessions() throws IOException {
        when(closedSession.isOpen()).thenReturn(false);
        NotificationWebSocketHandler handler = handlerWithSessions(closedSession);
        assertThat(handler.sessionCount()).isOne();

        handler.broadcast(new NotificationDTO("m", "t"));

        verify(closedSession, never()).sendMessage(any());
        assertThat(handler.sessionCount()).isZero();
    }

    @Test
    void aFailingSessionIsEvictedAndClosed() throws IOException {
        when(openSession.isOpen()).thenReturn(true);
        doThrow(new IOException("broken pipe")).when(openSession).sendMessage(any());
        NotificationWebSocketHandler handler = handlerWithSessions(openSession);
        assertThat(handler.sessionCount()).isOne();

        handler.broadcast(new NotificationDTO("m", "t"));
        handler.broadcast(new NotificationDTO("m", "t"));

        // First broadcast evicts + closes; second never touches the session again.
        verify(openSession).sendMessage(any());
        verify(openSession).close();
        assertThat(handler.sessionCount()).isZero();
    }

    @Test
    void broadcastWithNoSessionsIsANoOp() throws IOException {
        NotificationWebSocketHandler handler = handlerWithSessions();

        handler.broadcast(new NotificationDTO("m", "t"));

        verify(openSession, never()).sendMessage(any());
    }
}
