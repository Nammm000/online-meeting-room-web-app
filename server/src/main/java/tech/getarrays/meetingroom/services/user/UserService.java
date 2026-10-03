package tech.getarrays.meetingroom.services.user;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.getarrays.meetingroom.models.AccountLevel;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.models.meeting.Meeting;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantStatus;
import tech.getarrays.meetingroom.repo.AccountLevelRepo;
import tech.getarrays.meetingroom.repo.MeetingChatMessageRepo;
import tech.getarrays.meetingroom.repo.MeetingParticipantRepo;
import tech.getarrays.meetingroom.repo.MeetingRepo;
import tech.getarrays.meetingroom.repo.UserRepo;
import tech.getarrays.meetingroom.services.auth.refreshToken.RefreshTokenService;
import tech.getarrays.meetingroom.services.image.UserImageService;
import tech.getarrays.meetingroom.services.pdf.UserPdfFileService;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;
import tech.getarrays.meetingroom.util.UserUtils;
import tech.getarrays.meetingroom.wrapper.UserWrapper;

import tech.getarrays.meetingroom.exception.UserNotFoundException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
public class UserService {

    private static final String PLACEHOLDER_EMAIL = "DELETED_USER@gmail.com";
    private static final String PLACEHOLDER_NAME = "DELETED_USER";
    private static final String PLACEHOLDER_PHONE = "0000000000";
    private static final String DEFAULT_ACCOUNT_LEVEL_CODE = "BASIC"; // mirrors AuthServiceImpl.defaultAccountLevel()

    UserRepo userRepo;
    RefreshTokenService refreshTokenService;
    MeetingRepo meetingRepo;
    MeetingParticipantRepo participantRepo;
    MeetingChatMessageRepo chatMessageRepo;
    UserPdfFileService userPdfFileService;
    UserImageService userImageService;
    AccountLevelRepo accountLevelRepo;
    PasswordEncoder passwordEncoder;

    /** Serializes lazy placeholder creation — a Postgres unique violation would abort the whole delete transaction. */
    private final Object placeholderLock = new Object();

    @Autowired
    public UserService(UserRepo theUserRepo,
                       RefreshTokenService theRefreshTokenService,
                       MeetingRepo theMeetingRepo,
                       MeetingParticipantRepo theParticipantRepo,
                       MeetingChatMessageRepo theChatMessageRepo,
                       UserPdfFileService theUserPdfFileService,
                       UserImageService theUserImageService,
                       AccountLevelRepo theAccountLevelRepo,
                       PasswordEncoder thePasswordEncoder) {
        userRepo = theUserRepo;
        refreshTokenService = theRefreshTokenService;
        meetingRepo = theMeetingRepo;
        participantRepo = theParticipantRepo;
        chatMessageRepo = theChatMessageRepo;
        userPdfFileService = theUserPdfFileService;
        userImageService = theUserImageService;
        accountLevelRepo = theAccountLevelRepo;
        passwordEncoder = thePasswordEncoder;
    }

    public ResponseEntity<List<UserWrapper>> getAllUsers() {
        try {
            return new ResponseEntity<>(userRepo.getAllUser(), HttpStatus.OK);
        } catch (Exception ex) {
            log.error("Error getting all users", ex);
            return new ResponseEntity<>(new ArrayList<>(), HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    public ResponseEntity<UserWrapper> getCurrentUserInformation() {
        User user = UserUtils.getCurrentUserWithAccountLevel();
        UserWrapper wrapper = new UserWrapper(
                user.getId(), user.getName(), user.getEmail(), user.getPhone(),
                user.getStatus(), user.getCreatedAt(), user.getRole(),
                user.getAccountLevel(), user.getAccountNumber());
        return new ResponseEntity<>(wrapper, HttpStatus.OK);
    }

    public ResponseEntity<String> updateUserStatus(Long id, Map<String, String> requestMap) {
        Optional<User> optional = userRepo.findById(id);
        if (optional.isPresent()) {
            userRepo.updateStatus(requestMap.get("status"), id);
            return MeetingRoomUtils.getResponseEntity("User status updated successfully", HttpStatus.OK);
        }
        log.error("updateUserStatus: User id {} doesn't exist", id);
        throw new UserNotFoundException("User id " + id + " doesn't exist");
    }

    public ResponseEntity<String> updateUserRole(Long id, Map<String, String> requestMap) {
        Optional<User> optional = userRepo.findById(id);
        if (optional.isPresent()) {
            String userROLE = requestMap.get("role");
            try {
                User.Role userRole = User.Role.valueOf(userROLE);
                userRepo.updateRole(userRole, id);
                return MeetingRoomUtils.getResponseEntity("User role updated successfully", HttpStatus.OK);
            } catch (IllegalArgumentException e) {
                log.error("updateUserRole: Invalid role value '{}'", userROLE);
                return MeetingRoomUtils.getResponseEntity("Invalid role. Must be ROLE_USER or ROLE_ADMIN", HttpStatus.BAD_REQUEST);
            }
        }
        log.error("updateUserRole: User id {} doesn't exist", id);
        throw new UserNotFoundException("User id " + id + " doesn't exist");
    }

    /**
     * Hard-delete a user and every dependent row in one transaction (no FK has an
     * ON DELETE action). Meeting participant rows are not deleted — they are
     * reassigned to the lazily created DELETED_USER placeholder so past meetings
     * keep a "DELETED_USER" tombstone; hosted meetings are deleted outright
     * (chat → participants → meeting row, docs/meeting-database-design.md §5–6).
     * MinIO objects (pdfs, avatar) are removed best-effort AFTER the user row has
     * flushed, so a late FK failure can never leave rows pointing at missing objects.
     */
    @Transactional
    public ResponseEntity<String> deleteUser(Long id) {
        Optional<User> optional = userRepo.findById(id);
        if (optional.isEmpty()) {
            log.error("deleteUser: User id {} doesn't exist", id);
            throw new UserNotFoundException("User id " + id + " doesn't exist");
        }
        User user = optional.get();
        boolean isPlaceholder = PLACEHOLDER_EMAIL.equalsIgnoreCase(user.getEmail());
        User placeholder = isPlaceholder ? user : getOrCreateDeletedUserPlaceholder();

        // 1. Hosted meetings die whole: per meeting chat → participants, then the meeting rows.
        for (Meeting meeting : meetingRepo.findByHostId(user.getId())) {
            chatMessageRepo.deleteAllByMeetingId(meeting.getId());
            participantRepo.deleteAllByMeetingId(meeting.getId());
        }
        meetingRepo.deleteAllByHostId(user.getId());

        // 2. Chat footprint: everything they sent or received privately is erased with
        //    the account; soft-delete audit refs to them are nulled (message stays deleted).
        chatMessageRepo.deleteAllBySenderId(user.getId());
        chatMessageRepo.deleteAllByRecipientId(user.getId());
        chatMessageRepo.updateDeletedByToNull(user.getId());

        // 3. Participants: the placeholder's own accumulated rows are hard-deleted (they
        //    cannot be reassigned to itself); anyone else's rows become LEFT tombstones.
        if (isPlaceholder) {
            participantRepo.deleteAllByUserId(user.getId());
        } else {
            participantRepo.deletePlaceholderRowsInMeetingsOf(placeholder.getId(), user.getId());
            participantRepo.reassignToPlaceholder(placeholder.getId(), user.getId(),
                    ParticipantRole.PARTICIPANT, ParticipantStatus.LEFT, LocalDateTime.now());
        }
        participantRepo.updateAdmittedByToNull(user.getId());

        // 4. Auth + owned files (MinIO keys come back for the post-flush cleanup).
        refreshTokenService.deleteAllByUserId(user.getId());
        List<String> pdfObjectKeys = userPdfFileService.deleteAllForUser(user.getId());
        String avatarObjectKey = userImageService.deleteAvatarForUser(user.getId());

        // 5. The user row itself; flush so any FK violation surfaces BEFORE storage objects are destroyed.
        userRepo.delete(user);
        userRepo.flush();

        // 6. Best-effort storage cleanup — never throws, cannot roll back the transaction.
        userPdfFileService.removeObjects(pdfObjectKeys);
        if (avatarObjectKey != null) {
            userImageService.removeAvatarObject(avatarObjectKey);
        }
        return MeetingRoomUtils.getResponseEntity("User deleted successfully", HttpStatus.OK);
    }

    /**
     * Get-or-create the DELETED_USER tombstone account. Lazy — created on first user
     * deletion, no startup runner. Unusable random BCrypt password + status "false" +
     * ROLE_USER keep it locked out (status is not consulted at login today — see
     * project-overview known issues — the password is the effective gate).
     * saveAndFlush: the bulk reassign UPDATE above must see the row — @Modifying
     * queries do not auto-flush the persistence context.
     */
    private User getOrCreateDeletedUserPlaceholder() {
        synchronized (placeholderLock) {
            User existing = userRepo.findFirstByEmail(PLACEHOLDER_EMAIL);
            if (existing != null) {
                return existing;
            }
            User placeholder = new User();
            placeholder.setName(PLACEHOLDER_NAME);
            placeholder.setEmail(PLACEHOLDER_EMAIL);
            placeholder.setPhone(PLACEHOLDER_PHONE);
            placeholder.setRole(User.Role.ROLE_USER);
            placeholder.setStatus("false");
            placeholder.setPasswordHash(passwordEncoder.encode(UUID.randomUUID().toString()));
            placeholder.setCreatedAt(LocalDateTime.now());
            placeholder.setAccountNumber("ACC-" + UUID.randomUUID());
            placeholder.setAccountLevel(accountLevelRepo.findByCode(DEFAULT_ACCOUNT_LEVEL_CODE)
                    .orElseGet(() -> accountLevelRepo.save(AccountLevel.builder()
                            .code(DEFAULT_ACCOUNT_LEVEL_CODE)
                            .name("Basic")
                            .description("Default account level")
                            .build())));
            return userRepo.saveAndFlush(placeholder);
        }
    }
}
