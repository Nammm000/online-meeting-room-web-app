package tech.getarrays.meetingroom.services.auth.refreshToken;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.getarrays.meetingroom.constants.AuthConstants;
import tech.getarrays.meetingroom.exception.InvalidTokenException;
import tech.getarrays.meetingroom.models.RefreshToken;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.repo.RefreshTokenRepo;
import tech.getarrays.meetingroom.services.auth.TokenPair;
import tech.getarrays.meetingroom.util.JwtUtil;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;

@Service
public class RefreshTokenServiceImpl implements RefreshTokenService {

    private final RefreshTokenRepo refreshTokenRepo;
    private final JwtUtil jwtUtil;
    private final SecureRandom secureRandom = new SecureRandom();

    public RefreshTokenServiceImpl(RefreshTokenRepo refreshTokenRepo, JwtUtil jwtUtil) {
        this.refreshTokenRepo = refreshTokenRepo;
        this.jwtUtil = jwtUtil;
    }

    @Override
    @Transactional
    public String createToken(User user) {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);

        RefreshToken refreshToken = RefreshToken.builder()
                .token(token)
                .user(user)
                .expiresAt(LocalDateTime.now().plusDays(AuthConstants.REFRESH_TOKEN_EXPIRY_DAYS))
                .build();
        refreshTokenRepo.save(refreshToken);
        return token;
    }

    @Override
    @Transactional
    public TokenPair rotate(String rawToken) {
        RefreshToken refreshToken = refreshTokenRepo.findByToken(rawToken)
                .orElseThrow(() -> new InvalidTokenException("Invalid refresh token"));

        if (refreshToken.getExpiresAt().isBefore(LocalDateTime.now())) {
            refreshTokenRepo.deleteByToken(rawToken);
            throw new InvalidTokenException("Refresh token expired");
        }

        User user = refreshToken.getUser();
        String accessToken = jwtUtil.generateToken(user.getEmail(), user.getRole());
        String newRefreshToken = createToken(user);
        refreshTokenRepo.deleteByToken(rawToken);
        return new TokenPair(accessToken, newRefreshToken);
    }

    @Override
    @Transactional
    public void revoke(String rawToken) {
        if (rawToken != null && !rawToken.isBlank()) {
            refreshTokenRepo.deleteByToken(rawToken);
        }
    }

    @Override
    @Transactional
    public void deleteAllByUserId(Long userId) {
        refreshTokenRepo.deleteAllByUserId(userId);
    }
}
