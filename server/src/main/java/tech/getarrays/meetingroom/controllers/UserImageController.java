package tech.getarrays.meetingroom.controllers;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import tech.getarrays.meetingroom.dto.UserImageDTO;
import tech.getarrays.meetingroom.services.image.UserImageService;

@RestController
@RequestMapping("/images")
public class UserImageController {

    UserImageService userImageService;

    @Autowired
    public UserImageController(UserImageService theUserImageService) {
        userImageService = theUserImageService;
    }

    @PostMapping(value = "/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<UserImageDTO> uploadAvatar(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.ok(userImageService.uploadAvatar(file));
    }

    @DeleteMapping("/avatar")
    public ResponseEntity<String> deleteAvatar() {
        return userImageService.deleteAvatar();
    }

    @GetMapping("/avatar")
    public ResponseEntity<byte[]> getAvatar() {
        UserImageService.AvatarData avatar = userImageService.getAvatar();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(avatar.contentType()))
                .cacheControl(CacheControl.noCache())
                .body(avatar.data());
    }
}
