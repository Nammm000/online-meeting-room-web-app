package tech.getarrays.meetingroom.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;
import tech.getarrays.meetingroom.configuration.RequestSecurityContext;
import tech.getarrays.meetingroom.exception.NotFoundException;
import tech.getarrays.meetingroom.models.*;
import tech.getarrays.meetingroom.models.file.UserPdfFile;
import tech.getarrays.meetingroom.repo.UserRepo;

@Slf4j
@Component
public class UserUtils {

    static UserRepo userRepo;
    static RequestSecurityContext requestSecurityContext;

    @Autowired
    public UserUtils(UserRepo theUserRepo,
                            RequestSecurityContext theRequestSecurityContext) {
        userRepo = theUserRepo;
        requestSecurityContext = theRequestSecurityContext;
    }

    public static void checkOwnership(UserPdfFile pdfFile) {
        if ("ROLE_ADMIN".equals(requestSecurityContext.getRole())) {
            return;
        }
        User user = getCurrentUser();
        if (!pdfFile.getUser().getId().equals(user.getId())) {
            log.warn("User {} tried to access pdf file {} owned by {}", user.getEmail(), pdfFile.getId(), pdfFile.getUser().getId());
            throw new AccessDeniedException("You don't have access to this file");
        }
    }

    public static User getCurrentUser() {
        User user = userRepo.findFirstByEmail(requestSecurityContext.getUsername());
        if (user == null) {
            throw new NotFoundException("Authenticated user doesn't exist");
        }
        return user;
    }

    /**
     * Like getCurrentUser(), but join-fetches the lazy accountLevel so callers
     * that serialize it (GET /users/current-user) get the real entity instead
     * of an uninitialized Hibernate proxy, which Jackson cannot introspect.
     */
    public static User getCurrentUserWithAccountLevel() {
        User user = userRepo.findFirstWithAccountLevelByEmail(requestSecurityContext.getUsername());
        if (user == null) {
            throw new NotFoundException("Authenticated user doesn't exist");
        }
        return user;
    }
}
