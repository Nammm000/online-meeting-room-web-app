package tech.getarrays.meetingroom.models.file;

import jakarta.persistence.*;
import lombok.*;
import tech.getarrays.meetingroom.models.User;

import java.time.LocalDateTime;

/**
 * A PDF document uploaded by a user, stored in MinIO under
 * {@code pdfs/<userId>/<uuid>.pdf}. Standalone entity on purpose: the shared
 * {@code images} table behind the avatar hierarchy enforces one row per user
 * (unique user_id), which cannot model many files per user.
 */
@Entity
@Table(name = "user_pdf_files")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserPdfFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** MinIO object key — UUID-based, never derived from client input. */
    @Column(nullable = false, length = 500)
    private String objectKey;

    /** Sanitized original filename, kept for display/download naming only. */
    @Column(nullable = false, length = 255)
    private String fileName;

    @Column(nullable = false, length = 100)
    private String contentType;

    @Column(nullable = false)
    private Long fileSize;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
