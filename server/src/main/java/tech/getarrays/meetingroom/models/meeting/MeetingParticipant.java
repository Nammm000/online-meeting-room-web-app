package tech.getarrays.meetingroom.models.meeting;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.ColumnDefault;
import tech.getarrays.meetingroom.models.User;

import java.time.LocalDateTime;

/**
 * One row per (meeting, user) — the roster, waiting-room and moderation state
 * for a single participant. Rejoining reuses the row ({@code joinCount}
 * increments), so leave/rejoin history is tracked in place rather than in a
 * sessions table. Exactly one HOST row per meeting is a service-enforced
 * invariant (a partial unique constraint is not expressible in JPA).
 * Design: {@code docs/meeting-database-design.md}.
 */
@Entity
@Table(name = "meeting_participants",
        uniqueConstraints = @UniqueConstraint(name = "uq_meeting_participants_meeting_user",
                columnNames = {"meeting_id", "user_id"}),
        indexes = {
                @Index(name = "ix_meeting_participants_meeting_status", columnList = "meeting_id, status"),
                @Index(name = "ix_meeting_participants_user", columnList = "user_id")
        })
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MeetingParticipant {

    public enum ParticipantRole {
        HOST, COHOST, PARTICIPANT
    }

    public enum ParticipantStatus {
        WAITING, JOINED, LEFT, REMOVED, DENIED, DECLINED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "meeting_id", nullable = false)
    private Meeting meeting;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ParticipantRole role;

    /** WAITING is the waiting room — the participant sits in the lobby, not yet in the meeting. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ParticipantStatus status;

    /** Current audio state, persisted so it survives rejoin. */
    @Builder.Default
    @Column(nullable = false)
    private boolean muted = false;

    /**
     * Mic-energy flag reported by the client's local speech detection; clamped
     * to false while muted (service-enforced). ColumnDefault is required —
     * ddl-auto=update adds NOT NULL columns without a DEFAULT and would fail
     * on the non-empty dev table.
     */
    @Builder.Default
    @ColumnDefault("false")
    @Column(nullable = false)
    private boolean speaking = false;

    /** Set on the false→true transition; orders simultaneous speakers on the stage. */
    @Column(name = "last_speaking_at")
    private LocalDateTime lastSpeakingAt;

    /**
     * Raised-hand flag toggled by the participant (a moderator may lower it);
     * no mute clamp — a raised hand while muted is legitimate. ColumnDefault is
     * required — ddl-auto=update adds NOT NULL columns without a DEFAULT and
     * would fail on the non-empty dev table.
     */
    @Builder.Default
    @ColumnDefault("false")
    @Column(nullable = false)
    private boolean handRaised = false;

    /** Set when the hand goes up; orders raised hands for the host. */
    @Column(name = "last_hand_raised_at")
    private LocalDateTime lastHandRaisedAt;

    @Builder.Default
    @Column(name = "join_count", nullable = false)
    private int joinCount = 0;

    @Column(name = "first_joined_at")
    private LocalDateTime firstJoinedAt;

    @Column(name = "last_joined_at")
    private LocalDateTime lastJoinedAt;

    @Column(name = "last_left_at")
    private LocalDateTime lastLeftAt;

    /** Who admitted this participant from the waiting room (null = auto-admit / waiting room off). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "admitted_by_id")
    private User admittedBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
