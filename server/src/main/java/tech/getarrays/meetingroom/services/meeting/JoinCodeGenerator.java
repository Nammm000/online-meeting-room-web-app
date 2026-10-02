package tech.getarrays.meetingroom.services.meeting;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;

/**
 * Join codes: 10 glyphs from the 31-character uppercase Crockford-style base32
 * alphabet (no 0/O/1/I — unambiguous when read aloud), ~8×10^14 codes. The
 * join code is the only external meeting identifier (join links never carry
 * the internal id). Collisions are astronomically rare but real: the unique
 * constraint turns one into a DataIntegrityViolationException, which
 * MeetingService retries.
 */
@Component
public class JoinCodeGenerator {

    static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    static final int CODE_LENGTH = 10;

    private final SecureRandom random = new SecureRandom();

    public String generate() {
        StringBuilder code = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }
}
