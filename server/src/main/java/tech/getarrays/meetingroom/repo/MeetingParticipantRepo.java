package tech.getarrays.meetingroom.repo;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface MeetingParticipantRepo extends JpaRepository<MeetingParticipant, Long> {

    /** The (meeting, user) row if the user has ever interacted with the meeting — rejoin reuses it. */
    Optional<MeetingParticipant> findByMeetingIdAndUserId(@Param("meetingId") Long meetingId,
                                                          @Param("userId") Long userId);

    /** Waiting-room roster (WAITING) and in-meeting roster (JOINED) — same query, different status. */
    List<MeetingParticipant> findByMeetingIdAndStatus(@Param("meetingId") Long meetingId,
                                                      @Param("status") ParticipantStatus status);

    /** PM recipient check: has this user ever touched the meeting (any status)? */
    boolean existsByMeetingIdAndUserId(@Param("meetingId") Long meetingId, @Param("userId") Long userId);

    /** "Meetings I attended" and the source for user-deletion cleanup. */
    List<MeetingParticipant> findByUserId(@Param("userId") Long userId);

    /** Meeting end: bulk-move every participant from one status to another in one statement (e.g. JOINED → LEFT). */
    @Transactional
    @Modifying
    @Query("update MeetingParticipant p set p.status = :newStatus, p.lastLeftAt = :leftAt, p.speaking = false " +
           "where p.meeting.id = :meetingId and p.status = :oldStatus")
    Integer updateStatusForMeeting(@Param("meetingId") Long meetingId,
                                   @Param("oldStatus") ParticipantStatus oldStatus,
                                   @Param("newStatus") ParticipantStatus newStatus,
                                   @Param("leftAt") LocalDateTime leftAt);

    /** Co-host promote/demote (HOST is immutable — the service must reject role changes on the host row). */
    @Transactional
    @Modifying
    @Query("update MeetingParticipant p set p.role = :role where p.id = :id")
    Integer updateRole(@Param("role") ParticipantRole role, @Param("id") Long id);

    /** Meeting deletion: drop the roster after the chat messages, before the meeting row. */
    @Transactional
    @Modifying
    @Query("delete from MeetingParticipant p where p.meeting.id = :meetingId")
    Integer deleteAllByMeetingId(@Param("meetingId") Long meetingId);

    /** User-account cleanup: HOST rows are left behind on purpose — their meetings are deleted by host id first. */
    @Transactional
    @Modifying
    @Query("delete from MeetingParticipant p where p.user.id = :userId and p.role <> :role")
    Integer deleteAllByUserIdAndRoleNot(@Param("userId") Long userId, @Param("role") ParticipantRole role);
}
