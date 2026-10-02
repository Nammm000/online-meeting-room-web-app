package tech.getarrays.meetingroom.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tech.getarrays.meetingroom.dto.NotificationDTO;

import java.time.Instant;

/**
 * Broadcasts the generic reminder to every connected client on a fixed interval
 * (default 30 minutes — override with app.notification.interval-ms, e.g. 15000
 * for a demo run). Global push: no per-user resolution, so no request-scoped
 * context is needed here.
 */
@Slf4j
@Component
public class NotificationScheduler {

    private NotificationWebSocketHandler handler;

    private String message;

    @Autowired
    public NotificationScheduler(NotificationWebSocketHandler theHandler,
                                 @Value("${app.notification.message:Reminder: please review your assets.}") String theMessage) {
        this.handler = theHandler;
        this.message = theMessage;
    }

    @Scheduled(fixedRateString = "${app.notification.interval-ms:1800000}")
    public void broadcastReminder() {
        log.info("Broadcasting scheduled notification to {} session(s)", handler.sessionCount());
        handler.broadcast(new NotificationDTO(message, Instant.now().toString()));
    }
}
