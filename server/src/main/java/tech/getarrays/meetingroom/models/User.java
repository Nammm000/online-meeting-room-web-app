package tech.getarrays.meetingroom.models;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@NamedQuery(name = "User.getAllUser" , query = "select new tech.getarrays.meetingroom.wrapper.UserWrapper(u.id, u.name, u.email, u.phone, u.status, u.createdAt, u.role) from User u")

@NamedQuery(name = "User.updateStatus" , query = "update User u set u.status=:status where u.id =:id")



@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    public enum Role {
        ROLE_USER, ROLE_ADMIN, ROLE_CUSTOMER
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    private String phone;

    private String name;

    @Enumerated(EnumType.STRING)
    private Role role;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "account_number", nullable = false, unique = true, length = 50)
    private String accountNumber;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "status")
    private String status;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_level_id", nullable = false)
    private AccountLevel accountLevel;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}