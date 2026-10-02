package tech.getarrays.meetingroom.repo;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import tech.getarrays.meetingroom.models.file.UserPdfFile;

public interface UserPdfFileRepo extends JpaRepository<UserPdfFile, Long> {

    Page<UserPdfFile> findByUserId(Long userId, Pageable pageable);
}
