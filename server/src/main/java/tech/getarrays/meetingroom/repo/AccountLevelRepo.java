package tech.getarrays.meetingroom.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import tech.getarrays.meetingroom.models.AccountLevel;

import java.util.Optional;

@Repository
public interface AccountLevelRepo extends JpaRepository<AccountLevel, Long> {
    Optional<AccountLevel> findByCode(String code);
}
