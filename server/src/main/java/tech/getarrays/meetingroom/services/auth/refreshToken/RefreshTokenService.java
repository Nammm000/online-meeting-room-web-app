package tech.getarrays.meetingroom.services.auth.refreshToken;

import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.services.auth.TokenPair;

public interface RefreshTokenService {

    String createToken(User user);

    TokenPair rotate(String rawToken);

    void revoke(String rawToken);

    void deleteAllByUserId(Long userId);
}
