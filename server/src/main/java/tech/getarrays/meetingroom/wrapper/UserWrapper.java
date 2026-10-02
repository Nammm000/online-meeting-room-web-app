package tech.getarrays.meetingroom.wrapper;

import lombok.Data;
import lombok.NoArgsConstructor;
import tech.getarrays.meetingroom.models.AccountLevel;
import tech.getarrays.meetingroom.models.User.Role;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
public class UserWrapper {
    private Long id;
    private String name;
    private String email;
    private String phone;
    private String status;
    private LocalDateTime createdTime;
    private Role role;

    private AccountLevel accountLevel;
    private String accountNumber;

    public UserWrapper(Long id, String name, String email, String phone, String status, LocalDateTime createdTime, Role role) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.phone = phone;
        this.status = status;
        this.createdTime = createdTime;
        this.role = role;
    }

    public UserWrapper(Long id, String name, String email, String phone, String status, LocalDateTime createdTime,
                       Role role, AccountLevel accountLevel, String accountNumber) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.phone = phone;
        this.status = status;
        this.createdTime = createdTime;
        this.role = role;
        this.accountLevel = accountLevel;
        this.accountNumber = accountNumber;
    }
}