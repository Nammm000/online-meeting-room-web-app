package tech.getarrays.meetingroom.services.user;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.constants.AssetConstants;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.repo.UserRepo;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;
import tech.getarrays.meetingroom.util.UserUtils;
import tech.getarrays.meetingroom.wrapper.UserWrapper;

import tech.getarrays.meetingroom.exception.UserNotFoundException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
public class UserService {

    UserRepo userRepo;

    @Autowired
    public UserService(UserRepo theUserRepo) {
        userRepo = theUserRepo;
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

    // Deleting a user cascades their assets - drop their cached passbook list and by-id entries too
    @CacheEvict(cacheNames = {AssetConstants.CACHE_SAVINGS_PASSBOOKS, AssetConstants.CACHE_SAVINGS_PASSBOOK},
            allEntries = true)
    public ResponseEntity<String> deleteUser(Long id) {
        Optional<User> optional = userRepo.findById(id);
        if (optional.isPresent()) {
            userRepo.deleteById(id);
            return MeetingRoomUtils.getResponseEntity("User deleted successfully", HttpStatus.OK);
        }
        log.error("deleteUser: User id {} doesn't exist", id);
        throw new UserNotFoundException("User id " + id + " doesn't exist");
    }
}
