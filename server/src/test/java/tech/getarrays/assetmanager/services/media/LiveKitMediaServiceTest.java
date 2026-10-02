package tech.getarrays.meetingroom.services.media;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.livekit.server.RoomServiceClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import retrofit2.Call;
import tech.getarrays.meetingroom.configuration.LiveKitProperties;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LiveKitMediaServiceTest {

    private static final String API_SECRET = "test-secret-for-livekit-media-service";

    private RoomServiceClient roomServiceClient;
    private LiveKitMediaService service;

    @BeforeEach
    void setUp() {
        roomServiceClient = mock(RoomServiceClient.class);
        service = new LiveKitMediaService(roomServiceClient,
                new LiveKitProperties("http://localhost:7880", "devkey", API_SECRET,
                        Duration.ofMinutes(5), 900));
    }

    @Test
    @SuppressWarnings("unchecked")
    void mintedTokenCarriesTheVideoOnlyGrantSet() {
        String jwt = service.mintToken(7L, "Host User", "ABCD234567");

        Jws<Claims> parsed = Jwts.parserBuilder()
                .setSigningKey(API_SECRET.getBytes())
                .build()
                .parseClaimsJws(jwt);
        Claims claims = parsed.getBody();
        assertThat(claims.getIssuer()).isEqualTo("devkey");
        assertThat(claims.getSubject()).isEqualTo("7");

        Map<String, Object> video = claims.get("video", Map.class);
        assertThat(video.get("roomJoin")).isEqualTo(true);
        assertThat(video.get("room")).isEqualTo("ABCD234567");
        assertThat(video.get("canSubscribe")).isEqualTo(true);
        assertThat(video.get("canPublishData")).isEqualTo(false);
        assertThat((List<String>) video.get("canPublishSources"))
                .containsExactlyInAnyOrder("camera", "screen_share")
                .doesNotContain("microphone");

        // TTL honoured (±10s of the configured 5 minutes) — the SDK sets no iat claim,
        // so the window is measured from now
        long ttlMillis = claims.getExpiration().getTime() - System.currentTimeMillis();
        assertThat(ttlMillis).isBetween(290_000L, 310_000L);
    }

    @Test
    @SuppressWarnings("unchecked")
    void ensureRoomUsesTheConfiguredEmptyTimeout() throws IOException {
        Call<?> call = mock(Call.class);
        when(call.execute()).thenReturn(null);
        when(roomServiceClient.createRoom("ABCD234567", 900)).thenReturn((Call) call);

        assertThat(service.ensureRoom("ABCD234567")).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void roomFailuresAreSwallowed() throws IOException {
        Call<?> failing = mock(Call.class);
        when(failing.execute()).thenThrow(new IOException("livekit down"));
        when(roomServiceClient.createRoom(anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn((Call) failing);
        when(roomServiceClient.deleteRoom(anyString())).thenReturn((Call) failing);
        when(roomServiceClient.removeParticipant(anyString(), anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn((Call) failing);

        assertThatCode(() -> {
            assertThat(service.ensureRoom("X")).isFalse();
            assertThat(service.deleteRoom("X")).isFalse();
            assertThat(service.removeParticipant("X", 7L)).isFalse();
        }).doesNotThrowAnyException();
    }
}
