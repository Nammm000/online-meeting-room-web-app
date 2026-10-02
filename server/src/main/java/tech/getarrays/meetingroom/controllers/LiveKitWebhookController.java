package tech.getarrays.meetingroom.controllers;

import io.livekit.server.WebhookReceiver;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tech.getarrays.meetingroom.exception.InvalidTokenException;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.services.meeting.MeetingStateService;

/**
 * LiveKit's signed webhook sink. The path is permitAll in the security chain
 * and the REAL gate is right here — the same permitAll-delegates-to-the-check
 * pattern as {@code /ws/**}: the SDK's {@link WebhookReceiver} verifies the
 * JWT signature (HMAC-SHA256, issuer = api key) AND the body sha256 digest,
 * so the raw body is consumed as a String (the exact bytes LiveKit signed).
 * Always answers 200 fast for valid deliveries — a non-2xx makes LiveKit
 * retry, including for events we deliberately ignore.
 *
 * Event policy (the DB-wins rule): {@code participant_left} is the only event
 * that mutates state, idempotently; {@code room_finished} is logged and
 * ignored — a media room dying never ends a meeting the host hasn't ended.
 */
@Slf4j
@RestController
public class LiveKitWebhookController {

    private final WebhookReceiver webhookReceiver;
    private final MeetingRepo meetingRepo;
    private final MeetingStateService stateService;

    public LiveKitWebhookController(WebhookReceiver webhookReceiver,
                                    MeetingRepo meetingRepo,
                                    MeetingStateService stateService) {
        this.webhookReceiver = webhookReceiver;
        this.meetingRepo = meetingRepo;
        this.stateService = stateService;
    }

    @PostMapping(value = "/webhooks/livekit", consumes = MediaType.APPLICATION_JSON_VALUE)
    public String receive(@RequestBody String body,
                          @RequestHeader(value = "Authorization", required = false) String authorization) {
        var event = verify(body, authorization);
        String eventName = event.getEvent();
        switch (eventName == null ? "" : eventName) {
            case "participant_joined" -> log.debug("LiveKit participant_joined: room={} identity={}",
                    roomName(event), identity(event)); // presence is UI state, not DB state
            case "participant_left" -> meetingRepo.findByJoinCode(roomName(event)).ifPresent(meeting -> {
                try {
                    stateService.markLeftIfJoined(meeting.getId(), Long.parseLong(identity(event)));
                } catch (NumberFormatException e) {
                    log.warn("LiveKit participant_left with non-numeric identity '{}': {} ", identity(event),
                            roomName(event));
                }
            });
            case "room_finished" -> log.info("LiveKit room_finished: {} (DB wins — no meeting transition)",
                    roomName(event));
            default -> log.debug("LiveKit webhook ignored: {}", eventName);
        }
        return "ok";
    }

    /** Signature/digest failure renders as 401 via the existing handler. */
    private livekit.LivekitWebhook.WebhookEvent verify(String body, String authorization) {
        try {
            return webhookReceiver.receive(body, authorization == null ? "" : authorization);
        } catch (Exception e) {
            throw new InvalidTokenException("Invalid LiveKit webhook signature");
        }
    }

    private static String roomName(livekit.LivekitWebhook.WebhookEvent event) {
        return event.hasRoom() ? event.getRoom().getName() : null;
    }

    private static String identity(livekit.LivekitWebhook.WebhookEvent event) {
        return event.hasParticipant() ? event.getParticipant().getIdentity() : null;
    }
}
