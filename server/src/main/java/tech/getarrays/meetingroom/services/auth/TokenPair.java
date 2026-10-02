package tech.getarrays.meetingroom.services.auth;

/**
 * Internal rotation result: the new access JWT plus the new opaque refresh token.
 * Never serialized — the refresh token leaves the server only as an HttpOnly cookie,
 * so controllers split the pair instead of returning it in a response body.
 */
public record TokenPair(String accessToken, String refreshToken) {
}
