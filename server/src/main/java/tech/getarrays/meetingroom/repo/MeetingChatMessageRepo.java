package tech.getarrays.meetingroom.repo;

import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import tech.getarrays.meetingroom.models.meeting.MeetingChatMessage;

import java.time.LocalDateTime;

@Repository
public interface MeetingChatMessageRepo extends JpaRepository<MeetingChatMessage, Long> {

    /**
     * Visible messages of a meeting. Callers fix the sort server-side to
     * {@code sentAt DESC, id DESC} (the id breaks same-second ties) — the same
     * fixed-sort paging convention as {@code UserPdfFileRepo}.
     */
    Page<MeetingChatMessage> findByMeetingIdAndDeletedAtIsNull(@Param("meetingId") Long meetingId,
                                                               Pageable pageable);

    /** Soft delete by host or author; already-deleted rows stay untouched (returns 0). */
    @Transactional
    @Modifying
    @Query("update MeetingChatMessage m set m.deletedAt = :deletedAt, m.deletedBy.id = :deletedById " +
           "where m.id = :id and m.deletedAt is null")
    Integer softDelete(@Param("id") Long id,
                       @Param("deletedById") Long deletedById,
                       @Param("deletedAt") LocalDateTime deletedAt);

    /** Meeting deletion: chat goes first, before the participants and the meeting row. */
    @Transactional
    @Modifying
    @Query("delete from MeetingChatMessage m where m.meeting.id = :meetingId")
    Integer deleteAllByMeetingId(@Param("meetingId") Long meetingId);

    /** User-account cleanup: hard-delete of everything the user ever sent (soft-deleted content is audit-only, not kept past the account). */
    @Transactional
    @Modifying
    @Query("delete from MeetingChatMessage m where m.sender.id = :senderId")
    Integer deleteAllBySenderId(@Param("senderId") Long senderId);
}
