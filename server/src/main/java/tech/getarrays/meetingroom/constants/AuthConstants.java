package tech.getarrays.meetingroom.constants;

public class AuthConstants {

    public static final int ACCESS_TOKEN_EXPIRY_MINUTES = 15;
    public static final int REFRESH_TOKEN_EXPIRY_DAYS = 7;

    public static final String TOKEN_TYPE_ACCESS = "access";

    /** HttpOnly cookie carrying the refresh token; Path=/auth hides it from document.cookie too. */
    public static final String REFRESH_TOKEN_COOKIE = "asset-manager.refreshToken";
    public static final String REFRESH_COOKIE_PATH = "/auth";
}
