package tech.getarrays.meetingroom.controllers;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import tech.getarrays.meetingroom.services.user.UserService;
import tech.getarrays.meetingroom.wrapper.UserWrapper;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/users")
public class UserController {

    UserService userService;

    @Autowired
    public UserController(UserService theUserService) {
        userService = theUserService;
    }


    @GetMapping
    @PreAuthorize("hasRole('ADMIN')") // hasAuthority('ADMIN')
    public ResponseEntity<List<UserWrapper>> getAllUsers() {
        return userService.getAllUsers();
    }

    @GetMapping("/current-user")
    public ResponseEntity<UserWrapper> getCurrentUserInformation() {
        return userService.getCurrentUserInformation();
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasRole('ADMIN')") // hasAuthority('ADMIN')
    public ResponseEntity<String> patchUserStatus(@PathVariable Long id, @RequestBody Map<String, String> requestMap) {
        return userService.updateUserStatus(id, requestMap);
    }

    @PatchMapping("/{id}/role")
    @PreAuthorize("hasRole('ADMIN')") // hasAuthority('ADMIN')
    public ResponseEntity<String> patchUserRole(@PathVariable Long id, @RequestBody Map<String, String> requestMap) {
        return userService.updateUserRole(id, requestMap);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')") // hasAuthority('ADMIN')
    public ResponseEntity<String> deleteUser(@PathVariable Long id) {
        return userService.deleteUser(id);
    }
}
