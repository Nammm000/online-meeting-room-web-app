package tech.getarrays.meetingroom.repo;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import tech.getarrays.meetingroom.models.file.UserPdfFile;

import java.util.List;

public interface UserPdfFileRepo extends JpaRepository<UserPdfFile, Long> {

    Page<UserPdfFile> findByUserId(Long userId, Pageable pageable);

    /** User-account cleanup: every PDF row of the user, unpaged, for bulk deletion + MinIO key collection. */
    List<UserPdfFile> findByUserId(Long userId);
}
