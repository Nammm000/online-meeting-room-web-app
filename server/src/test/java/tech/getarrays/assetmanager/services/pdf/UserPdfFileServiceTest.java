package tech.getarrays.meetingroom.services.pdf;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.util.Collections;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UserPdfFileServiceTest {

    // Repo/MinIO stay untouched on the validation paths under test, so nulls are fine.
    private final UserPdfFileService service = new UserPdfFileService(null, null, "test-bucket");

    private static MockMultipartFile pdf(String name, int size) {
        return new MockMultipartFile("files", name, "application/pdf", new byte[size]);
    }

    @Test
    void rejectsEmptyFileList() {
        assertThatThrownBy(() -> service.uploadPdfFiles(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Select at least one PDF file");
        assertThatThrownBy(() -> service.uploadPdfFiles(Collections.emptyList()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Select at least one PDF file");
    }

    @Test
    void rejectsMoreThanTenFiles() {
        List<MultipartFile> eleven = IntStream.rangeClosed(1, 11)
                .mapToObj(i -> (MultipartFile) pdf("doc" + i + ".pdf", 1))
                .toList();
        assertThatThrownBy(() -> service.uploadPdfFiles(eleven))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Cannot upload more than 10 files at once");
    }

    @Test
    void rejectsEmptyFile() {
        assertThatThrownBy(() -> service.uploadPdfFiles(List.of(pdf("empty.pdf", 0))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("File 'empty.pdf' is empty");
    }

    @Test
    void rejectsOversizeFile() {
        MockMultipartFile oversize = new MockMultipartFile(
                "files", "big.pdf", "application/pdf", new byte[20 * 1024 * 1024 + 1]);
        assertThatThrownBy(() -> service.uploadPdfFiles(List.of(oversize)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("File 'big.pdf' must be smaller than 20MB");
    }

    @Test
    void rejectsNonPdfContentType() {
        MockMultipartFile text = new MockMultipartFile("files", "notes.txt", "text/plain", new byte[10]);
        assertThatThrownBy(() -> service.uploadPdfFiles(List.of(text)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("File 'notes.txt' is not a PDF");
    }

    @Test
    void isPdfAcceptsPdfMimeType() {
        assertThat(UserPdfFileService.isPdf(pdf("report.pdf", 1))).isTrue();
    }

    @Test
    void isPdfRejectsOtherMimeType() {
        MockMultipartFile png = new MockMultipartFile("files", "report.png", "image/png", new byte[1]);
        assertThat(UserPdfFileService.isPdf(png)).isFalse();
    }

    @Test
    void isPdfFallsBackToExtensionWhenMimeTypeMissing() {
        // Drag-and-drop from some sources delivers no MIME type at all
        MockMultipartFile noMime = new MockMultipartFile("files", "report.pdf", null, new byte[1]);
        assertThat(UserPdfFileService.isPdf(noMime)).isTrue();

        MockMultipartFile noMimeWrongExt = new MockMultipartFile("files", "report.txt", null, new byte[1]);
        assertThat(UserPdfFileService.isPdf(noMimeWrongExt)).isFalse();
    }

    @Test
    void sanitizeFileNameKeepsPlainNames() {
        assertThat(UserPdfFileService.sanitizeFileName("report.pdf")).isEqualTo("report.pdf");
        assertThat(UserPdfFileService.sanitizeFileName("  report.pdf  ")).isEqualTo("report.pdf");
    }

    @Test
    void sanitizeFileNameStripsPathComponents() {
        assertThat(UserPdfFileService.sanitizeFileName("/etc/passwd")).isEqualTo("passwd");
        assertThat(UserPdfFileService.sanitizeFileName("C:\\Users\\me\\doc.pdf")).isEqualTo("doc.pdf");
    }

    @Test
    void sanitizeFileNameFallsBackForMissingOrUnsafeNames() {
        assertThat(UserPdfFileService.sanitizeFileName(null)).isEqualTo("document.pdf");
        assertThat(UserPdfFileService.sanitizeFileName("")).isEqualTo("document.pdf");
        assertThat(UserPdfFileService.sanitizeFileName("..")).isEqualTo("document.pdf");
    }

    @Test
    void sanitizeFileNameTruncatesToColumnLimit() {
        String longName = "a".repeat(300) + ".pdf";
        assertThat(UserPdfFileService.sanitizeFileName(longName)).hasSize(255);
    }
}
