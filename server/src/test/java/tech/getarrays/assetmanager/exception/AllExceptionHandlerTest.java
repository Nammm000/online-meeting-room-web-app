package tech.getarrays.meetingroom.exception;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import tech.getarrays.meetingroom.dto.ErrorResponseDTO;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import static org.assertj.core.api.Assertions.assertThat;

class AllExceptionHandlerTest {

    private final AllExceptionHandler handler = new AllExceptionHandler();

    @Test
    void oversizeUploadMessageContainsConfiguredLimit() {
        ResponseEntity<ErrorResponseDTO> response =
                handler.handleException(new MaxUploadSizeExceededException(21 * 1024 * 1024));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getMessage()).contains("21.0 MB");
    }

    @Test
    void oversizeUploadMessageOmitsUnknownLimit() {
        ResponseEntity<ErrorResponseDTO> response =
                handler.handleException(new MaxUploadSizeExceededException(-1));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getMessage())
                .isEqualTo("Upload exceeds the maximum allowed size")
                .doesNotContain("MB");
    }
}
