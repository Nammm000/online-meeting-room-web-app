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

    /**
     * User-account cleanup: reassign every participant row of the deleted user to the
     * DELETED_USER placeholder tombstone. The tombstone holds no authority and no
     * presence: rows land as plain LEFT participants (roster/lobby show only
     * JOINED/WAITING, so a mid-meeting delete leaves no ghost).
     */
    @Transactional
    @Modifying
    @Query("update MeetingParticipant p set p.user.id = :placeholderId, p.role = :role, " +
           "p.status = :status, p.lastLeftAt = :leftAt, p.speaking = false " +
           "where p.user.id = :userId")
    Integer reassignToPlaceholder(@Param("placeholderId") Long placeholderId,
                                  @Param("userId") Long userId,
                                  @Param("role") ParticipantRole role,
                                  @Param("status") ParticipantStatus status,
                                  @Param("leftAt") LocalDateTime leftAt);

    /**
     * Unique(meeting_id, user_id) conflict clear before {@link #reassignToPlaceholder}:
     * drop the placeholder's earlier tombstone rows in meetings where the deleted user
     * also has a row, so the reassign UPDATE cannot violate the constraint. The
     * just-deleted user's row (fresher state) is the one kept per meeting.
     */
    @Transactional
    @Modifying
    @Query("delete from MeetingParticipant p where p.user.id = :placeholderId and p.meeting.id in " +
           "(select p2.meeting.id from MeetingParticipant p2 where p2.user.id = :userId)")
    Integer deletePlaceholderRowsInMeetingsOf(@Param("placeholderId") Long placeholderId,
                                              @Param("userId") Long userId);

    /** User deletion: admittedBy is nullable display metadata — null it, don't tombstone it. */
    @Transactional
    @Modifying
    @Query("update MeetingParticipant p set p.admittedBy = null where p.admittedBy.id = :userId")
    Integer updateAdmittedByToNull(@Param("userId") Long userId);

    /** Placeholder self-delete: its accumulated tombstone rows are hard-deleted (cannot be reassigned to itself). */
    @Transactional
    @Modifying
    @Query("delete from MeetingParticipant p where p.user.id = :userId")
    Integer deleteAllByUserId(@Param("userId") Long userId);
}
