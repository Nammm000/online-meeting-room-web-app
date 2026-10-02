package tech.getarrays.meetingroom.services.auth.auth;

import tech.getarrays.meetingroom.dto.Auth.SignupDTO;
import tech.getarrays.meetingroom.dto.UserDTO;

public interface AuthService {
    UserDTO createUser(SignupDTO signupDTO);
}
