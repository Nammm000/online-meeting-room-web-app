package tech.getarrays.meetingroom.models.image;

import jakarta.persistence.*;
import lombok.*;
import tech.getarrays.meetingroom.models.User;


@Entity
@Table(name = "images")
@Inheritance(strategy = InheritanceType.JOINED)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public abstract class Image {

    public enum ImageType {
        AVATAR
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    @Column(nullable = false, length = 500)
    private String objectKey; // filesystem paths

    @Column(nullable = false, length = 100)
    private String contentType; // full MIME type: image/png, image/jpeg, image/webp

    @Column(nullable = false)
    private Long fileSize; // Maximum: 5 MB
}
