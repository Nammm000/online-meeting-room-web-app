package tech.getarrays.meetingroom.services.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class RefreshCookieServiceTest {

    private String setCookieHeader(MockHttpServletResponse response) {
        return response.getHeader("Set-Cookie");
    }

    @Test
    void writeEmitsHttpOnlyStrictCookieOnTheAuthPath() {
        RefreshCookieService service = new RefreshCookieService(false);
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.write(response, "abc123");

        String header = setCookieHeader(response);
        assertThat(header).isNotNull();
        assertThat(header).contains("asset-manager.refreshToken=abc123");
        assertThat(header).contains("HttpOnly");
        assertThat(header).contains("SameSite=Strict");
        assertThat(header).contains("Path=/auth");
        // 7 days, matching the server-side refresh-token expiry.
        assertThat(header).contains("Max-Age=604800");
        assertThat(header).doesNotContain("Secure");
    }

    @Test
    void writeMarksTheCookieSecureWhenConfigured() {
        RefreshCookieService service = new RefreshCookieService(true);
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.write(response, "abc123");

        assertThat(setCookieHeader(response)).contains("Secure");
    }

    @Test
    void clearExpiresTheCookieImmediately() {
        RefreshCookieService service = new RefreshCookieService(false);
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.clear(response);

        String header = setCookieHeader(response);
        assertThat(header).contains("asset-manager.refreshToken=");
        assertThat(header).contains("Max-Age=0");
        assertThat(header).contains("HttpOnly");
        assertThat(header).contains("SameSite=Strict");
        assertThat(header).contains("Path=/auth");
    }
}
