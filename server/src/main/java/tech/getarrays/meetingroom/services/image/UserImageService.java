package tech.getarrays.meetingroom.services.image;

import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import tech.getarrays.meetingroom.dto.UserImageDTO;
import tech.getarrays.meetingroom.exception.NotFoundException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.image.UserImage;
import tech.getarrays.meetingroom.repo.UserImageRepo;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;
import tech.getarrays.meetingroom.util.UserUtils;

import java.io.InputStream;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
public class UserImageService {

    private static final long MAX_SIZE_BYTES = 5 * 1024 * 1024;
    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of("image/png", "image/jpeg", "image/webp");
    private static final Map<String, String> EXTENSIONS_BY_CONTENT_TYPE = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/webp", ".webp");

    UserImageRepo userImageRepo;
    MinioClient minioClient;
    String bucket;

    @Autowired
    public UserImageService(UserImageRepo theUserImageRepo,
                            MinioClient theMinioClient,
                            @Value("${app.minio.bucket}") String theBucket) {
        userImageRepo = theUserImageRepo;
        minioClient = theMinioClient;
        bucket = theBucket;
    }

    public UserImageDTO uploadAvatar(MultipartFile file) {
        String contentType = validateImage(file);
        User user = UserUtils.getCurrentUser();
        String objectKey = "avatars/" + user.getId() + "/"
                + UUID.randomUUID() + EXTENSIONS_BY_CONTENT_TYPE.get(contentType);

        putObject(file, contentType, objectKey);

        UserImage image = userImageRepo.findByUserId(user.getId()).orElse(null);
        if (image != null) {
            removeObject(image.getObjectKey());
        } else {
            image = new UserImage();
            image.setUser(user);
        }
        image.setObjectKey(objectKey);
        image.setContentType(contentType);
        image.setFileSize(file.getSize());
        return toDTO(userImageRepo.save(image));
    }

    public ResponseEntity<String> deleteAvatar() {
        User user = UserUtils.getCurrentUser();
        UserImage image = userImageRepo.findByUserId(user.getId())
                .orElseThrow(() -> new NotFoundException("No avatar uploaded"));
        userImageRepo.delete(image);
        removeObject(image.getObjectKey());
        return MeetingRoomUtils.getResponseEntity("Avatar deleted successfully", HttpStatus.OK);
    }

    public AvatarData getAvatar() {
        User user = UserUtils.getCurrentUser();
        UserImage image = userImageRepo.findByUserId(user.getId())
                .orElseThrow(() -> new NotFoundException("No avatar uploaded"));
        byte[] data;
        try (InputStream in = minioClient.getObject(GetObjectArgs.builder()
                .bucket(bucket)
                .object(image.getObjectKey())
                .build())) {
            data = in.readAllBytes();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to read image from storage: " + e.getMessage(), e);
        }
        return new AvatarData(data, image.getContentType());
    }

    public record AvatarData(byte[] data, String contentType) {
    }

    private String validateImage(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Image cannot be empty");
        }
        if (file.getSize() > MAX_SIZE_BYTES) {
            throw new IllegalArgumentException("Image must be smaller than 5MB");
        }
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType)) {
            throw new IllegalArgumentException("Only png, jpeg and webp images are allowed");
        }
        return contentType;
    }

    private void putObject(MultipartFile file, String contentType, String objectKey) {
        try (InputStream in = file.getInputStream()) {
            minioClient.putObject(PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .stream(in, file.getSize(), -1)
                    .contentType(contentType)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to store image: " + e.getMessage(), e);
        }
    }

    private void removeObject(String objectKey) {
        try {
            minioClient.removeObject(RemoveObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .build());
        } catch (Exception e) {
            log.warn("Failed to delete old avatar object '{}' from MinIO: {}", objectKey, e.getMessage());
        }
    }

    private UserImageDTO toDTO(UserImage image) {
        UserImageDTO dto = new UserImageDTO();
        dto.setId(image.getId());
        dto.setContentType(image.getContentType());
        dto.setFileSize(image.getFileSize());
        return dto;
    }
}
