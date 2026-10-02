package tech.getarrays.meetingroom.services.media;

import org.junit.jupiter.api.Test;
import tech.getarrays.meetingroom.configuration.JanusProperties;

import static org.assertj.core.api.Assertions.assertThat;

class RoomSecretDeriverTest {

    private final RoomSecretDeriver deriver = new RoomSecretDeriver(
            new JanusProperties("http://localhost:8088/janus", "ws://localhost:8188",
                    "admin", "test-pepper-value", 48000));

    @Test
    void derivationIsDeterministicAcrossInstances() {
        RoomSecretDeriver otherInstance = new RoomSecretDeriver(
                new JanusProperties("u", "w", "k", "test-pepper-value", 48000));
        assertThat(deriver.roomSecret(42L)).isEqualTo(otherInstance.roomSecret(42L));
        assertThat(deriver.roomPin(42L)).isEqualTo(otherInstance.roomPin(42L));
    }

    @Test
    void secretAndPinAreDistinctAndLengthStable() {
        assertThat(deriver.roomSecret(42L)).hasSize(24);
        assertThat(deriver.roomPin(42L)).hasSize(8);
        assertThat(deriver.roomSecret(42L)).isNotEqualTo(deriver.roomPin(42L));
    }

    @Test
    void differentMeetingsGetDifferentCredentials() {
        assertThat(deriver.roomSecret(1L)).isNotEqualTo(deriver.roomSecret(2L));
        assertThat(deriver.roomPin(1L)).isNotEqualTo(deriver.roomPin(2L));
    }

    @Test
    void differentPeppersChangeEverything() {
        RoomSecretDeriver otherPepper = new RoomSecretDeriver(
                new JanusProperties("u", "w", "k", "a-different-pepper", 48000));
        assertThat(deriver.roomSecret(42L)).isNotEqualTo(otherPepper.roomSecret(42L));
    }
}
