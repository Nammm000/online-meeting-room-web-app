package tech.getarrays.meetingroom.controllers;

import io.livekit.server.WebhookReceiver;
import livekit.LivekitModels;
import livekit.LivekitWebhook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tech.getarrays.meetingroom.exception.InvalidTokenException;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.services.meeting.MeetingStateService;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LiveKitWebhookControllerTest {

    private WebhookReceiver webhookReceiver;
    private MeetingRepo meetingRepo;
    private MeetingStateService stateService;
    private LiveKitWebhookController controller;

    @BeforeEach
    void setUp() {
        webhookReceiver = mock(WebhookReceiver.class);
        meetingRepo = mock(MeetingRepo.class);
        stateService = mock(MeetingStateService.class);
        controller = new LiveKitWebhookController(webhookReceiver, meetingRepo, stateService);
    }

    private static LivekitWebhook.WebhookEvent event(String name, String room, String identity) {
        LivekitWebhook.WebhookEvent.Builder builder = LivekitWebhook.WebhookEvent.newBuilder()
                .setEvent(name);
        if (room != null) {
            builder.setRoom(LivekitModels.Room.newBuilder().setName(room));
        }
        if (identity != null) {
            builder.setParticipant(LivekitModels.ParticipantInfo.newBuilder().setIdentity(identity));
        }
        return builder.build();
    }

    @Test
    void invalidSignatureIsRejectedAs401() {
        when(webhookReceiver.receive(anyString(), anyString()))
                .thenThrow(new RuntimeException("JWT verification failed"));

        assertThatThrownBy(() -> controller.receive("{}", "Bearer garbage"))
                .isInstanceOf(InvalidTokenException.class);
        verify(stateService, never()).markLeftIfJoined(anyLong(), anyLong());
    }

    @Test
    void participantLeftMovesTheParticipantToLeftOnly() {
        Meeting meeting = Meeting.builder().build();
        meeting.setId(5L);
        when(webhookReceiver.receive(anyString(), anyString()))
                .thenReturn(event("participant_left", "ABCD234567", "9"));
        when(meetingRepo.findByJoinCode("ABCD234567")).thenReturn(Optional.of(meeting));

        assertThat(controller.receive("{}", "Bearer valid")).isEqualTo("ok");

        verify(stateService).markLeftIfJoined(5L, 9L);
    }

    @Test
    void participantLeftWithNonNumericIdentityIsIgnored() {
        when(webhookReceiver.receive(anyString(), anyString()))
                .thenReturn(event("participant_left", "ABCD234567", "not-a-number"));
        when(meetingRepo.findByJoinCode("ABCD234567"))
                .thenReturn(Optional.of(Meeting.builder().build()));

        assertThat(controller.receive("{}", "Bearer valid")).isEqualTo("ok");
        verify(stateService, never()).markLeftIfJoined(anyLong(), anyLong());
    }

    @Test
    void unknownRoomIsIgnored() {
        when(webhookReceiver.receive(anyString(), anyString()))
                .thenReturn(event("participant_left", "NOSUCHROOM", "9"));
        when(meetingRepo.findByJoinCode("NOSUCHROOM")).thenReturn(Optional.empty());

        assertThat(controller.receive("{}", "Bearer valid")).isEqualTo("ok");
        verify(stateService, never()).markLeftIfJoined(anyLong(), anyLong());
    }

    @Test
    void roomFinishedNeverEndsTheMeeting() { // the DB-wins rule
        when(webhookReceiver.receive(anyString(), anyString()))
                .thenReturn(event("room_finished", "ABCD234567", null));

        assertThat(controller.receive("{}", "Bearer valid")).isEqualTo("ok");
        verify(stateService, never()).markEnded(anyLong());
        verify(stateService, never()).markLeftIfJoined(anyLong(), anyLong());
    }

    @Test
    void participantJoinedIsPresenceOnly() {
        when(webhookReceiver.receive(anyString(), anyString()))
                .thenReturn(event("participant_joined", "ABCD234567", "9"));

        assertThat(controller.receive("{}", "Bearer valid")).isEqualTo("ok");
        verify(stateService, never()).markLeftIfJoined(anyLong(), anyLong());
        verify(stateService, never()).markEnded(anyLong());
    }
}
