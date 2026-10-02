package tech.getarrays.meetingroom.services.meeting;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class JoinCodeGeneratorTest {

    private final JoinCodeGenerator generator = new JoinCodeGenerator();

    @Test
    void generatesTenCharacterCodesFromTheAmbiguityFreeAlphabet() {
        for (int i = 0; i < 100; i++) {
            String code = generator.generate();
            assertThat(code).hasSize(JoinCodeGenerator.CODE_LENGTH);
            assertThat(code.chars())
                    .as("every glyph is in the Crockford-style alphabet")
                    .allMatch(c -> JoinCodeGenerator.ALPHABET.indexOf(c) >= 0);
        }
    }

    @Test
    void alphabetExcludesAmbiguousGlyphs() {
        assertThat(JoinCodeGenerator.ALPHABET).doesNotContain("0", "O", "1", "I");
        assertThat(JoinCodeGenerator.ALPHABET).hasSize(31);
    }

    @Test
    void codesDoNotRepeatAtSmokeTestScale() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            seen.add(generator.generate());
        }
        assertThat(seen).hasSize(1000);
    }
}
