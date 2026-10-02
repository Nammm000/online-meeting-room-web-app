package tech.getarrays.meetingroom.dto.Auth;

/**
 * Login/signup/refresh response. The refresh token is NOT here — it travels as the
 * HttpOnly {@link tech.getarrays.meetingroom.constants.AuthConstants#REFRESH_TOKEN_COOKIE}
 * cookie written alongside this body.
 */
public record AuthenticationResponse(String accessToken) {

}
