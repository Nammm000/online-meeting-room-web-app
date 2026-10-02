package tech.getarrays.meetingroom.services.media;

import org.apache.commons.codec.binary.Hex;
import org.springframework.stereotype.Component;
import tech.getarrays.meetingroom.configuration.JanusProperties;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;

/**
 * Deterministic per-room AudioBridge credentials, derived by HMAC from the
 * configured pepper — no schema change, no stored state, and the pair survives
 * restarts of Spring and Janus alike. The <em>secret</em> (room admin, held
 * only by Spring — never exposed to a client: a secret-carrying joiner becomes
 * an admin who cannot be muted) and the <em>pin</em> (handed to admitted
 * clients with the room id) come from differently-prefixed inputs so one can
 * never be derived from the other.
 */
@Component
public class RoomSecretDeriver {

    private static final String HMAC_ALGORITHM = "HmacSHA256";

    private final byte[] pepper;

    public RoomSecretDeriver(JanusProperties janusProperties) {
        this.pepper = janusProperties.roomSecretPepper().getBytes(StandardCharsets.UTF_8);
    }

    /** Room admin secret — 24 hex chars. Spring-only knowledge. */
    public String roomSecret(Long meetingId) {
        return derive("admin:", meetingId, 24);
    }

    /** Room join pin — 8 hex chars, safe to hand to admitted clients. */
    public String roomPin(Long meetingId) {
        return derive("pin:", meetingId, 8);
    }

    private String derive(String prefix, Long meetingId, int length) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(pepper, HMAC_ALGORITHM));
            byte[] digest = mac.doFinal((prefix + meetingId).getBytes(StandardCharsets.UTF_8));
            return Hex.encodeHexString(digest).substring(0, length);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            // HmacSHA256 ships with every JDK — this is genuinely unreachable
            throw new IllegalStateException("Unable to derive room credentials", e);
        }
    }
}
