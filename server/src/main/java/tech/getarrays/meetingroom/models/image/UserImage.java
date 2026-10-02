package tech.getarrays.meetingroom.models.image;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "user_image")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserImage extends Image {

    @Enumerated(EnumType.STRING)
    @Column(name = "image_type", nullable = false, length = 30)
    private Image.ImageType imageType;

    @PrePersist
    protected void setImageType() {
        setImageType(Image.ImageType.AVATAR);
    }

}