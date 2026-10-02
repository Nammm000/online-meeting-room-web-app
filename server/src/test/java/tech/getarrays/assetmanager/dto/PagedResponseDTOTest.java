package tech.getarrays.meetingroom.dto;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.ArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PagedResponseDTOTest {

    @Test
    void emptyMatchesAnEmptySpringPage() {
        PagedResponseDTO<Object> empty = PagedResponseDTO.empty(2, 5);
        PagedResponseDTO<Object> fromDb = PagedResponseDTO.from(
                new PageImpl<>(new ArrayList<>(), PageRequest.of(2, 5), 0));

        assertThat(empty).isEqualTo(fromDb);
        assertThat(empty.getContent()).isEmpty();
        assertThat(empty.getPage()).isEqualTo(2);
        assertThat(empty.getSize()).isEqualTo(5);
        assertThat(empty.getTotalElements()).isZero();
        assertThat(empty.getTotalPages()).isZero();
        assertThat(empty.isFirst()).isFalse(); // page 2 has a previous page, like the DB path
        assertThat(empty.isLast()).isTrue();
    }

    @Test
    void emptyFirstPageReportsFirst() {
        PagedResponseDTO<Object> empty = PagedResponseDTO.empty(0, 10);

        assertThat(empty.isFirst()).isTrue();
        assertThat(empty.isLast()).isTrue();
    }

    @Test
    void emptyRejectsInvalidPagingLikeTheDbPath() {
        assertThatThrownBy(() -> PagedResponseDTO.empty(-1, 10))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
