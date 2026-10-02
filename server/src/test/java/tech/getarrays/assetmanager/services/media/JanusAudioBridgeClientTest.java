package tech.getarrays.meetingroom.services.media;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tech.getarrays.meetingroom.configuration.JanusProperties;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JanusAudioBridgeClientTest {

    private JanusHttpTransport transport;
    private JanusAudioBridgeClient client;
    private RoomSecretDeriver deriver;

    @BeforeEach
    void setUp() {
        transport = mock(JanusHttpTransport.class);
        JanusProperties properties = new JanusProperties(
                "http://localhost:8088/janus", "ws://localhost:8188", "admin-key", "pepper", 48000);
        deriver = new RoomSecretDeriver(properties);
        client = new JanusAudioBridgeClient(transport, properties, deriver);
        // session 1 → handle 10; every op posts create → attach → message (→ destroy in finally).
        // Mockito: raw path values must go through eq() once any() is in play.
        when(transport.post(org.mockito.ArgumentMatchers.eq(""), any()))
                .thenReturn(Map.of("janus", "success", "data", Map.of("id", 1L)));
        when(transport.post(org.mockito.ArgumentMatchers.eq("/1"), any()))
                .thenReturn(Map.of("janus", "success", "data", Map.of("id", 10L)));
    }

    private void pluginReplies(Map<String, Object> data) {
        // Path-aware: session/attach envelopes keep their shapes, only the
        // message path carries the plugin payload.
        when(transport.post(anyString(), any())).thenAnswer(inv -> {
            String path = inv.getArgument(0);
            if ("".equals(path)) {
                return Map.of("janus", "success", "data", Map.of("id", 1L));
            }
            if ("/1".equals(path)) {
                return Map.of("janus", "success", "data", Map.of("id", 10L));
            }
            return Map.of("janus", "success", "plugindata",
                    Map.of("plugin", "janus.plugin.audiobridge", "data", data));
        });
    }

    @Test
    void ensureRoomSkipsCreateWhenTheRoomExists() {
        pluginReplies(Map.of("audiobridge", "success", "exists", true));
        assertThat(client.ensureRoom(7L)).isTrue();
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        // create-session, attach, exists message, session destroy — and no room create
        verify(transport, times(4)).post(anyString(), body.capture());
        assertThat(body.getAllValues().get(2).get("body"))
                .isEqualTo(Map.of("request", "exists", "room", 7L));
    }

    @Test
    void ensureRoomCreatesWithSecretPinAndAdminKey() {
        when(transport.post(anyString(), any()))
                .thenAnswer(inv -> {
                    Map<String, Object> body = inv.getArgument(1);
                    if ("".equals(inv.getArgument(0))) {
                        return Map.of("janus", "success", "data", Map.of("id", 1L));
                    }
                    String path = inv.getArgument(0);
                    if ("/1".equals(path)) {
                        return Map.of("janus", "success", "data", Map.of("id", 10L));
                    }
                    if (path.startsWith("/1/") && body.containsKey("body") && ((Map<?, ?>) body.get("body")).get("request").equals("exists")) {
                        return Map.of("janus", "success", "plugindata", Map.of("data", Map.of("audiobridge", "success", "exists", false)));
                    }
                    return Map.of("janus", "success", "plugindata",
                            Map.of("data", Map.of("audiobridge", "created", "room", 7L)));
                });
        assertThat(client.ensureRoom(7L)).isTrue();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> message = ArgumentCaptor.forClass(Map.class);
        verify(transport, times(8)).post(anyString(), message.capture()); // exists + create, each 4 posts (session overhead + destroy)
        Map<?, ?> createBody = (Map<?, ?>) message.getAllValues().stream()
                .filter(m -> m.containsKey("body") && "create".equals(((Map<?, ?>) m.get("body")).get("request")))
                .findFirst().orElseThrow().get("body");
        assertThat(createBody.get("room")).isEqualTo(7L);
        assertThat(createBody.get("secret")).isEqualTo(deriver.roomSecret(7L));
        assertThat(createBody.get("pin")).isEqualTo(deriver.roomPin(7L));
        assertThat(createBody.get("admin_key")).isEqualTo("admin-key");
        assertThat(createBody.get("sampling_rate")).isEqualTo(48000);
    }

    @Test
    void adminMuteTargetsUserByIdWithSecret() {
        pluginReplies(Map.of("audiobridge", "success"));
        assertThat(client.adminMute(7L, 55L, true)).isTrue();
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> message = ArgumentCaptor.forClass(Map.class);
        verify(transport, times(4)).post(anyString(), message.capture()); // create, attach, mute, destroy
        Map<?, ?> muteBody = (Map<?, ?>) message.getAllValues().get(2).get("body");
        assertThat(muteBody.get("request")).isEqualTo("mute");
        assertThat(muteBody.get("room")).isEqualTo(7L);
        assertThat(muteBody.get("id")).isEqualTo(55L);
        assertThat(muteBody.get("secret")).isEqualTo(deriver.roomSecret(7L));
    }

    @Test
    void kickAndDestroyUseTheSecret() {
        // AudioBridge answers "success" for kick but "destroyed" for destroy
        when(transport.post(anyString(), any())).thenAnswer(inv -> {
            String path = inv.getArgument(0);
            if ("".equals(path)) {
                return Map.of("janus", "success", "data", Map.of("id", 1L));
            }
            if ("/1".equals(path)) {
                return Map.of("janus", "success", "data", Map.of("id", 10L));
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> body = (Map<String, Object>) ((Map<String, Object>) inv.getArgument(1)).get("body");
            String status = "destroy".equals(body.get("request")) ? "destroyed" : "success";
            return Map.of("janus", "success", "plugindata",
                    Map.of("plugin", "janus.plugin.audiobridge", "data", Map.of("audiobridge", status)));
        });
        assertThat(client.kick(7L, 55L)).isTrue();
        assertThat(client.destroyRoom(7L)).isTrue();
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> message = ArgumentCaptor.forClass(Map.class);
        verify(transport, times(8)).post(anyString(), message.capture()); // two ops × 4 posts
        List<Map<?, ?>> bodies = new java.util.ArrayList<>();
        message.getAllValues().forEach(m -> {
            if (m.containsKey("body")) {
                bodies.add((Map<?, ?>) m.get("body"));
            }
        });
        assertThat(bodies).anySatisfy(b -> assertThat(b.get("request")).isEqualTo("kick"));
        assertThat(bodies).anySatisfy(b -> assertThat(b.get("request")).isEqualTo("destroy"));
    }

    @Test
    void pluginErrorsNeverThrow() {
        pluginReplies(Map.of("audiobridge", "event", "error_code", 492, "error", "No such user"));
        assertThat(client.adminMute(7L, 55L, true)).isFalse();
    }

    @Test
    void transportFailuresNeverThrow() {
        when(transport.post(anyString(), any())).thenThrow(new RuntimeException("janus down"));
        assertThat(client.ensureRoom(7L)).isFalse();
        assertThat(client.destroyRoom(7L)).isFalse();
        assertThat(client.kick(7L, 1L)).isFalse();
    }

    @Test
    void destroySessionRunsEvenAfterPluginErrors() {
        pluginReplies(Map.of("audiobridge", "event", "error_code", 436, "error", "unauthorized"));
        assertThat(client.adminMute(7L, 55L, false)).isFalse();
        verify(transport, times(4)).post(anyString(), any()); // create, attach, message, destroy
    }

    @Test
    void failedSessionCreationMeansNoPluginCall() {
        when(transport.post(org.mockito.ArgumentMatchers.eq(""), any()))
                .thenReturn(Map.of("janus", "error"));
        assertThat(client.roomExists(7L)).isFalse();
        verify(transport, times(1)).post(anyString(), any());
        verify(transport, never()).post(org.mockito.ArgumentMatchers.eq("/1"), any());
    }
}
