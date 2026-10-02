package tech.getarrays.meetingroom.services.auth.auth;

import tech.getarrays.meetingroom.dto.Auth.SignupDTO;
import tech.getarrays.meetingroom.dto.UserDTO;
import tech.getarrays.meetingroom.exception.ConflictException;
import tech.getarrays.meetingroom.models.AccountLevel;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.repo.AccountLevelRepo;
import tech.getarrays.meetingroom.repo.UserRepo;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class AuthServiceImpl implements AuthService {

    private static final String DEFAULT_ACCOUNT_LEVEL_CODE = "BASIC";

    private final UserRepo userRepo;
    private final AccountLevelRepo accountLevelRepo;
    private final PasswordEncoder passwordEncoder;

    public AuthServiceImpl(UserRepo userRepo, AccountLevelRepo accountLevelRepo, PasswordEncoder passwordEncoder) {
        this.userRepo = userRepo;
        this.accountLevelRepo = accountLevelRepo;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public UserDTO createUser(SignupDTO signupDTO) {
        if (userRepo.findFirstByEmail(signupDTO.getEmail()) != null) {
            throw new ConflictException("This email has already been used.");
        }
        User user = new User();
        user.setName(signupDTO.getName());
        user.setEmail(signupDTO.getEmail());
        user.setPhone(signupDTO.getPhone());
        user.setRole(User.Role.ROLE_ADMIN);
        user.setStatus("true");
        user.setPasswordHash(passwordEncoder.encode(signupDTO.getPassword()));
        user.setCreatedAt(LocalDateTime.now());
        user.setAccountNumber("ACC-" + UUID.randomUUID());
        user.setAccountLevel(defaultAccountLevel());
        User createdUser = userRepo.save(user);

        UserDTO userDTO = new UserDTO();
        userDTO.setId(createdUser.getId());
        userDTO.setEmail(createdUser.getEmail());
        userDTO.setPhone(createdUser.getPhone());
        userDTO.setName(createdUser.getName());
        userDTO.setAccountNumber(createdUser.getAccountNumber());
        return userDTO;
    }

    private AccountLevel defaultAccountLevel() {
        return accountLevelRepo.findByCode(DEFAULT_ACCOUNT_LEVEL_CODE)
                .orElseGet(() -> accountLevelRepo.save(AccountLevel.builder()
                        .code(DEFAULT_ACCOUNT_LEVEL_CODE)
                        .name("Basic")
                        .description("Default account level")
                        .build()));
    }
}
