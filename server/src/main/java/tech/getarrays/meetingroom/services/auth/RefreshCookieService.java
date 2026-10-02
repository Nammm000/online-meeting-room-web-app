package tech.getarrays.meetingroom.services.auth;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;
import tech.getarrays.meetingroom.constants.AuthConstants;

import java.time.Duration;

/**
 * Writes/clears the HttpOnly refresh-token cookie. HttpOnly keeps the token out of
 * JavaScript reach; SameSite=Strict plus Path=/auth (it is only ever sent to
 * /auth/refresh and /auth/logout) is the CSRF mitigation — refresh is the one
 * purely cookie-authenticated endpoint, and rotation makes a CSRF'd refresh harmless.
 */
@Service
public class RefreshCookieService {

    private final boolean secure;

    public RefreshCookieService(@Value("${app.cookie.secure:false}") boolean secure) {
        this.secure = secure;
    }

    /** Issue (or rotate) the refresh cookie; Max-Age mirrors the server-side expiry. */
    public void write(HttpServletResponse response, String refreshToken) {
        ResponseCookie cookie = ResponseCookie.from(AuthConstants.REFRESH_TOKEN_COOKIE, refreshToken)
                .httpOnly(true)
                .secure(secure)
                .path(AuthConstants.REFRESH_COOKIE_PATH)
                .sameSite("Strict")
                .maxAge(Duration.ofDays(AuthConstants.REFRESH_TOKEN_EXPIRY_DAYS))
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    /** Expire the cookie immediately (logout, password change, failed refresh). */
    public void clear(HttpServletResponse response) {
        ResponseCookie cookie = ResponseCookie.from(AuthConstants.REFRESH_TOKEN_COOKIE, "")
                .httpOnly(true)
                .secure(secure)
                .path(AuthConstants.REFRESH_COOKIE_PATH)
                .sameSite("Strict")
                .maxAge(Duration.ZERO)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
