package tech.getarrays.meetingroom.dto;

import lombok.Data;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.ArrayList;
import java.util.List;

@Data
public class PagedResponseDTO<T> {

    private List<T> content;

    private int page;

    private int size;

    private long totalElements;

    private int totalPages;

    private boolean first;

    private boolean last;

    public static <T> PagedResponseDTO<T> from(Page<T> page) {
        PagedResponseDTO<T> dto = new PagedResponseDTO<>();
        dto.setContent(page.getContent());
        dto.setPage(page.getNumber());
        dto.setSize(page.getSize());
        dto.setTotalElements(page.getTotalElements());
        dto.setTotalPages(page.getTotalPages());
        dto.setFirst(page.isFirst());
        dto.setLast(page.isLast());
        return dto;
    }

    /**
     * An empty page result shaped exactly like a DB query that matched nothing — built through
     * {@link PageImpl} so the requested page/size are echoed the same way (including
     * {@code first=false} for page > 0 and the {@link PageRequest} argument validation).
     * Used by the Bloom-filter short-circuit; the ArrayList content keeps the value
     * round-trippable through the Redis cache's default-typing serializer.
     */
    public static <T> PagedResponseDTO<T> empty(int page, int size) {
        return from(new PageImpl<>(new ArrayList<>(), PageRequest.of(page, size), 0));
    }
}
