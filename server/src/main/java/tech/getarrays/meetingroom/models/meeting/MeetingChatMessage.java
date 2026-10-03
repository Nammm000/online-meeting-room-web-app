package tech.getarrays.meetingroom.models.meeting;

import jakarta.persistence.*;
import lombok.*;
import tech.getarrays.meetingroom.models.User;

import java.time.LocalDateTime;

/**
 * A persisted in-meeting chat message, viewable after the meeting ends.
 * Soft-deleted via {@code deletedAt}/{@code deletedBy} — content is retained
 * for audit and a message is visible iff {@code deletedAt} is null. Chat
 * inserts require the meeting to be IN_PROGRESS and the sender JOINED
 * (service-enforced). Design: {@code docs/meeting-database-design.md}.
 */
@Entity
@Table(name = "meeting_chat_messages",
        indexes = {
                @Index(name = "ix_meeting_chat_meeting_sent", columnList = "meeting_id, sent_at"),
                @Index(name = "ix_meeting_chat_sender", columnList = "sender_id")
        })
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MeetingChatMessage {

    public enum ChatMessageType {
        TEXT
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "meeting_id", nullable = false)
    private Meeting meeting;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    /** Null = broadcast to the whole meeting; otherwise only sender and recipient ever see the row. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recipient_id")
    private User recipient;

    @Column(nullable = false, length = 2000)
    private String content;

    /** Only TEXT today — the column exists so attachments/system messages later are an enum addition, not a migration. */
    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "message_type", nullable = false, length = 20)
    private ChatMessageType messageType = ChatMessageType.TEXT;

    @Column(name = "sent_at", nullable = false)
    private LocalDateTime sentAt;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    /** Who soft-deleted the message (host or author). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "deleted_by_id")
    private User deletedBy;

    @PrePersist
    protected void onCreate() {
        if (sentAt == null) {
            sentAt = LocalDateTime.now();
        }
    }
}
