package tech.getarrays.meetingroom.controllers;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import tech.getarrays.meetingroom.dto.PagedResponseDTO;
import tech.getarrays.meetingroom.dto.UserPdfFileDTO;
import tech.getarrays.meetingroom.services.pdf.UserPdfFileService;

import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/pdf-files")
public class UserPdfFileController {

    UserPdfFileService userPdfFileService;

    @Autowired
    public UserPdfFileController(UserPdfFileService theUserPdfFileService) {
        userPdfFileService = theUserPdfFileService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<UserPdfFileDTO>> uploadPdfFiles(@RequestParam("files") List<MultipartFile> files) {
        return userPdfFileService.uploadPdfFiles(files);
    }

    @GetMapping
    public ResponseEntity<PagedResponseDTO<UserPdfFileDTO>> getMyPdfFiles(@RequestParam(defaultValue = "0") int page,
                                                                          @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(userPdfFileService.getMyPdfFiles(page, size));
    }

    @GetMapping("/{id}")
    public ResponseEntity<byte[]> getPdfFile(@PathVariable Long id) {
        UserPdfFileService.PdfData pdf = userPdfFileService.getPdfFile(id);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .cacheControl(CacheControl.noCache())
                .contentLength(pdf.getData().length)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(pdf.getFileName(), StandardCharsets.UTF_8)
                        .build()
                        .toString())
                .body(pdf.getData());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<String> deletePdfFile(@PathVariable Long id) {
        return userPdfFileService.deletePdfFile(id);
    }
}
