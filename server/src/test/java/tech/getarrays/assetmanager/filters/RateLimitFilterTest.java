package tech.getarrays.meetingroom.filters;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitFilterTest {

    private static final String TOO_MANY_MESSAGE = "Too many requests. Please try again shortly.";

    /** Deterministic clock the tests advance by hand. */
    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        void advanceMillis(long millis) {
            instant = instant.plusMillis(millis);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private static MutableClock clockAtZero() {
        return new MutableClock(Instant.ofEpochMilli(0));
    }

    private static MockHttpServletRequest request(String method, String remoteAddr) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/irrelevant");
        request.setRemoteAddr(remoteAddr);
        return request;
    }

    private static void authenticateAs(String email) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                email, null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
    }

    private static void authenticateAnonymous() {
        SecurityContextHolder.getContext().setAuthentication(new AnonymousAuthenticationToken(
                "key", "anonymousUser", List.of(new SimpleGrantedAuthority("ROLE_ANONYMOUS"))));
    }

    /** Runs one request through the filter; returns the response and the downstream chain. */
    private record Run(MockHttpServletResponse response, MockFilterChain chain) {
        private Run(RateLimitFilter filter, MockHttpServletRequest request) {
            this(new MockHttpServletResponse(), new MockFilterChain());
            try {
                filter.doFilter(request, response, chain);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
    }

    private static Run run(RateLimitFilter filter, MockHttpServletRequest request) {
        return new Run(filter, request);
    }

    private static void assertChained(Run run) {
        assertThat(run.response().getStatus()).isEqualTo(200);
        assertThat(run.chain().getRequest()).isNotNull();
    }

    private static void assertRejected(Run run) {
        assertThat(run.response().getStatus()).isEqualTo(429);
        assertThat(run.chain().getRequest()).isNull();
    }

    @Test
    void chainsWhileUnderLimitThenReturns429() {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());

        for (int i = 0; i < 3; i++) {
            assertChained(run(filter, request("GET", "127.0.0.1")));
        }
        assertRejected(run(filter, request("GET", "127.0.0.1")));
    }

    @Test
    void fourTwentyNineBodyMatchesErrorShape() throws IOException {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());
        for (int i = 0; i < 3; i++) {
            run(filter, request("GET", "127.0.0.1"));
        }

        MockHttpServletResponse response = run(filter, request("GET", "127.0.0.1")).response();

        assertThat(response.getContentType()).isEqualTo("application/json");
        assertThat(response.getHeader("Retry-After")).isEqualTo("1");
        JsonNode body = new ObjectMapper().readTree(response.getContentAsString());
        assertThat(body.get("status").asInt()).isEqualTo(429);
        assertThat(body.get("message").asText()).isEqualTo(TOO_MANY_MESSAGE);
        assertThat(body.get("timeStamp").asLong()).isPositive();
    }

    @Test
    void rejectedRequestNeverReachesDownstream() {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());
        for (int i = 0; i < 3; i++) {
            run(filter, request("GET", "127.0.0.1"));
        }

        MockFilterChain chain = run(filter, request("GET", "127.0.0.1")).chain();

        assertThat(chain.getRequest()).isNull();
        assertThat(chain.getResponse()).isNull();
    }

    @Test
    void skipsOptionsRequests() {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());

        for (int i = 0; i < 5; i++) {
            assertChained(run(filter, request("OPTIONS", "127.0.0.1")));
        }
    }

    @Test
    void keysByAuthenticatedUser() {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());

        authenticateAs("a@example.com");
        for (int i = 0; i < 3; i++) {
            assertChained(run(filter, request("GET", "127.0.0.1")));
        }
        assertRejected(run(filter, request("GET", "127.0.0.1")));

        // A second user has their own bucket, even from the same IP.
        authenticateAs("b@example.com");
        assertChained(run(filter, request("GET", "127.0.0.1")));
    }

    @Test
    void fallsBackToIpWhenUnauthenticated() {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());

        for (int i = 0; i < 3; i++) {
            assertChained(run(filter, request("GET", "127.0.0.1")));
        }
        assertRejected(run(filter, request("GET", "127.0.0.1")));
        assertChained(run(filter, request("GET", "10.0.0.5")));
    }

    @Test
    void anonymousTokenCountsAsIpNotUser() {
        RateLimitFilter filter = new RateLimitFilter(3, clockAtZero());

        for (int i = 0; i < 3; i++) {
            assertChained(run(filter, request("GET", "127.0.0.1")));
        }

        // Without the instanceof guard every guest would share one "anonymous" bucket.
        authenticateAnonymous();
        assertRejected(run(filter, request("GET", "127.0.0.1")));
        assertChained(run(filter, request("GET", "10.0.0.5")));
    }

    @Test
    void windowSlidesWithinFilter() {
        MutableClock clock = clockAtZero();
        RateLimitFilter filter = new RateLimitFilter(3, clock);

        for (int i = 0; i < 3; i++) {
            assertChained(run(filter, request("GET", "127.0.0.1")));
        }
        assertRejected(run(filter, request("GET", "127.0.0.1")));

        clock.advanceMillis(1000);
        assertChained(run(filter, request("GET", "127.0.0.1")));
    }
}
