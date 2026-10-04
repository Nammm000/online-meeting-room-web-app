package tech.getarrays.meetingroom.models.meeting;

import jakarta.persistence.*;
import lombok.*;
import tech.getarrays.meetingroom.models.User;

import java.time.LocalDateTime;

/**
 * A scheduled or instant meeting. The {@code joinCode} (uppercase
 * Crockford-style base32, no 0/O/1/I) is the only external identifier — the
 * internal id is never exposed in join links. {@code host} deliberately
 * duplicates the HOST-role participant row so host-ownership checks and
 * "my meetings" queries stay single-table; the service layer keeps the two in
 * sync (exactly one HOST participant matching {@code meetings.host_id}).
 * Design: {@code docs/meeting-database-design.md}.
 */
@Entity
@Table(name = "meetings",
        uniqueConstraints = @UniqueConstraint(name = "uq_meetings_join_code", columnNames = "join_code"),
        indexes = {
                @Index(name = "ix_meetings_host", columnList = "host_id"),
                @Index(name = "ix_meetings_status_start", columnList = "status, scheduled_start_at"),
                @Index(name = "ix_meetings_screen_sharer", columnList = "screen_sharer_id")
        })
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Meeting {

    public enum MeetingType {
        SCHEDULED, INSTANT
    }

    public enum MeetingStatus {
        SCHEDULED, IN_PROGRESS, ENDED, CANCELLED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "host_id", nullable = false)
    private User host;

    /** The exclusive screen sharer (null = nobody) — claimed atomically via {@code MeetingRepo.claimScreenSharerIfFree}. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "screen_sharer_id")
    private User screenSharer;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 1000)
    private String description;

    /** Service-generated random code from the base32 alphabet; retried on a unique-violation collision. */
    @Column(name = "join_code", nullable = false, length = 10)
    private String joinCode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MeetingType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MeetingStatus status;

    /** Required iff {@code type = SCHEDULED} (service-enforced — conditional nullability is not expressible in DDL). */
    @Column(name = "scheduled_start_at")
    private LocalDateTime scheduledStartAt;

    @Column(name = "scheduled_end_at")
    private LocalDateTime scheduledEndAt;

    @Column(name = "actual_start_at")
    private LocalDateTime actualStartAt;

    @Column(name = "ended_at")
    private LocalDateTime endedAt;

    @Builder.Default
    @Column(name = "waiting_room_enabled", nullable = false)
    private boolean waitingRoomEnabled = false;

    @Builder.Default
    @Column(name = "mute_on_entry", nullable = false)
    private boolean muteOnEntry = false;

    /** While true no new joins or re-admits are accepted. */
    @Builder.Default
    @Column(nullable = false)
    private boolean locked = false;

    /** BCrypt hash of the optional join password; null = open meeting. Never serialized — the DTO exposes only {@code hasPassword}. */
    @Column(name = "password_hash", length = 100)
    private String passwordHash;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
        if (status == null) {
            status = type == MeetingType.INSTANT ? MeetingStatus.IN_PROGRESS : MeetingStatus.SCHEDULED;
        }
    }
}
