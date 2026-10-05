package tech.getarrays.meetingroom.services.pdf;

import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.Caching;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import tech.getarrays.meetingroom.constants.CacheConstants;
import tech.getarrays.meetingroom.dto.PagedResponseDTO;
import tech.getarrays.meetingroom.dto.UserPdfFileDTO;
import tech.getarrays.meetingroom.exception.NotFoundException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.file.UserPdfFile;
import tech.getarrays.meetingroom.repo.UserPdfFileRepo;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;
import tech.getarrays.meetingroom.util.UserUtils;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Slf4j
@Service
public class UserPdfFileService {

    private static final long MAX_SIZE_BYTES = 20L * 1024 * 1024;
    private static final int MAX_FILES_PER_REQUEST = 10;
    private static final String PDF_CONTENT_TYPE = "application/pdf";
    private static final String PDF_EXTENSION = ".pdf";

    UserPdfFileRepo userPdfFileRepo;
    MinioClient minioClient;
    String bucket;

    @Autowired
    public UserPdfFileService(UserPdfFileRepo theUserPdfFileRepo,
                              MinioClient theMinioClient,
                              @Value("${app.minio.pdf-bucket}") String theBucket) {
        userPdfFileRepo = theUserPdfFileRepo;
        minioClient = theMinioClient;
        bucket = theBucket;
    }

    @Caching(evict = {
            @CacheEvict(cacheNames = CacheConstants.CACHE_USER_PDFS, allEntries = true),
            @CacheEvict(cacheNames = CacheConstants.CACHE_USER_PDF, allEntries = true)
    })
    public ResponseEntity<List<UserPdfFileDTO>> uploadPdfFiles(List<MultipartFile> files) {
        validateFiles(files);
        User user = UserUtils.getCurrentUser();
        List<UserPdfFileDTO> uploaded = new ArrayList<>();
        List<String> createdObjectKeys = new ArrayList<>();
        try {
            for (MultipartFile file : files) {
                String fileName = sanitizeFileName(file.getOriginalFilename());
                String objectKey = "pdfs/" + user.getId() + "/" + UUID.randomUUID() + PDF_EXTENSION;
                putObject(file, objectKey);
                createdObjectKeys.add(objectKey);
                UserPdfFile pdfFile = UserPdfFile.builder()
                        .user(user)
                        .objectKey(objectKey)
                        .fileName(fileName)
                        .contentType(PDF_CONTENT_TYPE)
                        .fileSize(file.getSize())
                        .build();
                uploaded.add(toDTO(userPdfFileRepo.save(pdfFile)));
            }
        } catch (Exception e) {
            // Roll back the objects stored so far in this request (rows and objects
            // must stay in sync); DB deletes cascade nothing here, so remove manually.
            for (String objectKey : createdObjectKeys) {
                removeObject(objectKey);
            }
            throw new IllegalStateException("Failed to store PDF file: " + e.getMessage(), e);
        }
        return new ResponseEntity<>(uploaded, HttpStatus.CREATED);
    }

    // Plain DTO, not ResponseEntity: ResponseEntity has no default creator and is not
    // reliably Jackson-deserializable as a Redis cache value — the controller wraps it.
    // Key is the JWT subject (email) from the request-scoped context: zero DB queries,
    // and per-user keys mean one caller can never read another's cached page.
    @Cacheable(cacheNames = CacheConstants.CACHE_USER_PDFS,
            key = "@requestSecurityContext.username + ':' + #page + ':' + #size")
    public PagedResponseDTO<UserPdfFileDTO> getMyPdfFiles(int page, int size) {
        User user = UserUtils.getCurrentUser();
        Page<UserPdfFileDTO> pdfFiles = userPdfFileRepo
                .findByUserId(user.getId(), PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")))
                .map(this::toDTO);
        return PagedResponseDTO.from(pdfFiles);
    }

    // Per-user key again: a cache hit skips findOwnedPdfFile/checkOwnership below, but an
    // entry under <email>:<id> can only have been primed by that same authenticated user
    // (or an admin, under the admin's own key) — no cross-user leak. 404/403 throw inside
    // the body, so failed probes are never cached. The unless-guard skips payloads over
    // 5MB (Base64 JSON would be ~2/3 larger in Redis) — those always re-fetch from MinIO.
    @Cacheable(cacheNames = CacheConstants.CACHE_USER_PDF,
            key = "@requestSecurityContext.username + ':' + #id",
            unless = "#result != null && #result.data.length > 5 * 1024 * 1024")
    public PdfData getPdfFile(Long id) {
        UserPdfFile pdfFile = findOwnedPdfFile(id);
        byte[] data;
        try (InputStream in = minioClient.getObject(GetObjectArgs.builder()
                .bucket(bucket)
                .object(pdfFile.getObjectKey())
                .build())) {
            data = in.readAllBytes();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to read PDF file from storage: " + e.getMessage(), e);
        }
        return new PdfData(data, pdfFile.getFileName());
    }

    // allEntries (not a targeted <owner>:<id> key): an admin may delete another user's
    // file, and the owner's cache key isn't derivable from the deleter's request context.
    @Caching(evict = {
            @CacheEvict(cacheNames = CacheConstants.CACHE_USER_PDFS, allEntries = true),
            @CacheEvict(cacheNames = CacheConstants.CACHE_USER_PDF, allEntries = true)
    })
    public ResponseEntity<String> deletePdfFile(Long id) {
        UserPdfFile pdfFile = findOwnedPdfFile(id);
        // DB row first, then best-effort MinIO removal — an orphaned object is
        // recoverable, a row pointing at a missing object is not.
        userPdfFileRepo.delete(pdfFile);
        removeObject(pdfFile.getObjectKey());
        return MeetingRoomUtils.getResponseEntity("PDF file deleted successfully", HttpStatus.OK);
    }

    /**
     * User-account cleanup, called inside the caller's transaction: hard-delete every
     * PDF row of the user in one bulk statement and return the MinIO object keys so
     * the caller can best-effort-remove the objects after its DB work has flushed.
     */
    public List<String> deleteAllForUser(Long userId) {
        List<UserPdfFile> files = userPdfFileRepo.findByUserId(userId);
        if (!files.isEmpty()) {
            userPdfFileRepo.deleteAllInBatch(files);
        }
        return files.stream().map(UserPdfFile::getObjectKey).toList();
    }

    /** Best-effort MinIO removal of many objects — never throws (removeObject swallows and logs). */
    public void removeObjects(List<String> objectKeys) {
        objectKeys.forEach(this::removeObject);
    }

    /**
     * A plain Lombok POJO, deliberately not a record: records are implicitly final, so
     * the cache serializer's NON_FINAL default typing writes no {@code @class} hint and
     * deserialization silently yields a LinkedHashMap. The no-arg ctor + typed
     * {@code byte[]} field make it round-trip (Base64) through the Redis value.
     */
    @Data
    @AllArgsConstructor
    public static class PdfData {
        private byte[] data;
        private String fileName;
    }

    private UserPdfFile findOwnedPdfFile(Long id) {
        UserPdfFile pdfFile = userPdfFileRepo.findById(id)
                .orElseThrow(() -> new NotFoundException("PDF file id " + id + " doesn't exist"));
        UserUtils.checkOwnership(pdfFile);
        return pdfFile;
    }

    private void validateFiles(List<MultipartFile> files) {
        if (files == null || files.isEmpty()) {
            throw new IllegalArgumentException("Select at least one PDF file");
        }
        if (files.size() > MAX_FILES_PER_REQUEST) {
            throw new IllegalArgumentException("Cannot upload more than " + MAX_FILES_PER_REQUEST + " files at once");
        }
        for (MultipartFile file : files) {
            String fileName = displayName(file.getOriginalFilename());
            if (file == null || file.isEmpty()) {
                throw new IllegalArgumentException("File '" + fileName + "' is empty");
            }
            if (file.getSize() > MAX_SIZE_BYTES) {
                throw new IllegalArgumentException("File '" + fileName + "' must be smaller than 20MB");
            }
            if (!isPdf(file)) {
                throw new IllegalArgumentException("File '" + fileName + "' is not a PDF");
            }
        }
    }

    /** Visible for tests. */
    static boolean isPdf(MultipartFile file) {
        String contentType = file.getContentType();
        if (PDF_CONTENT_TYPE.equals(contentType)) {
            return true;
        }
        // Some drag-and-drop sources deliver files without a MIME type — fall
        // back to the extension so they are not rejected outright.
        return (contentType == null || contentType.isBlank())
                && displayName(file.getOriginalFilename()).toLowerCase(Locale.ROOT).endsWith(PDF_EXTENSION);
    }

    /** Visible for tests. */
    static String sanitizeFileName(String name) {
        if (name == null || name.isBlank()) {
            return "document.pdf";
        }
        String cleaned = name;
        // Strip any path components a client may have sent.
        int slash = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
        if (slash >= 0) {
            cleaned = cleaned.substring(slash + 1);
        }
        cleaned = cleaned.trim();
        if (cleaned.isEmpty() || ".".equals(cleaned) || "..".equals(cleaned)) {
            return "document.pdf";
        }
        if (cleaned.length() > 255) {
            cleaned = cleaned.substring(0, 255);
        }
        return cleaned;
    }

    private static String displayName(String originalFilename) {
        return (originalFilename == null || originalFilename.isBlank()) ? "unnamed" : originalFilename;
    }

    private void putObject(MultipartFile file, String objectKey) {
        try (InputStream in = file.getInputStream()) {
            minioClient.putObject(PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .stream(in, file.getSize(), -1)
                    .contentType(PDF_CONTENT_TYPE)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to store PDF file: " + e.getMessage(), e);
        }
    }

    private void removeObject(String objectKey) {
        try {
            minioClient.removeObject(RemoveObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .build());
        } catch (Exception e) {
            log.warn("Failed to delete PDF object '{}' from MinIO: {}", objectKey, e.getMessage());
        }
    }

    private UserPdfFileDTO toDTO(UserPdfFile pdfFile) {
        UserPdfFileDTO dto = new UserPdfFileDTO();
        dto.setId(pdfFile.getId());
        dto.setFileName(pdfFile.getFileName());
        dto.setContentType(pdfFile.getContentType());
        dto.setFileSize(pdfFile.getFileSize());
        dto.setCreatedAt(pdfFile.getCreatedAt());
        return dto;
    }
}
