package tech.getarrays.meetingroom.repo;

import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.Meeting.MeetingStatus;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface MeetingRepo extends JpaRepository<Meeting, Long> {

    /** Join-link lookup — the only query path for external join codes. */
    Optional<Meeting> findByJoinCode(@Param("joinCode") String joinCode);

    Page<Meeting> findByHostId(@Param("hostId") Long hostId, Pageable pageable);

    /** User-account cleanup: all meetings the user hosts (any status), for ordered chat→participants deletion. */
    List<Meeting> findByHostId(@Param("hostId") Long hostId);

    List<Meeting> findByHostIdAndStatusIn(@Param("hostId") Long hostId,
                                          @Param("statuses") Collection<MeetingStatus> statuses);

    @Transactional
    @Modifying
    @Query("update Meeting m set m.status = :status where m.id = :id")
    Integer updateStatus(@Param("status") MeetingStatus status, @Param("id") Long id);

    /** User-account cleanup: hard-delete of every meeting the user hosts (chat/participants go first — see design doc). */
    @Transactional
    @Modifying
    @Query("delete from Meeting m where m.host.id = :hostId")
    Integer deleteAllByHostId(@Param("hostId") Long hostId);
}
