package tech.getarrays.meetingroom.filters;

import tech.getarrays.meetingroom.util.SlidingWindowRateLimiter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;

/**
 * Caps each client at {@code app.rate-limit.requests-per-second} requests per rolling
 * second and rejects the excess with 429 + Retry-After. Clients are keyed by the JWT
 * subject (email) once authenticated, otherwise by remote address; OPTIONS preflights
 * are exempt. Registered INSIDE the security chain directly after JwtRequestFilter and
 * must stay there: the JWT filter clears the SecurityContext in a finally block once
 * the chain returns, so a plain servlet filter outside the chain would never see the
 * user identity.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final long WINDOW_MILLIS = 1000;

    private final SlidingWindowRateLimiter rateLimiter;

    // Two constructors and no @Autowired would leave Spring without an injection
    // candidate ("No default constructor found" at startup).
    @Autowired
    public RateLimitFilter(@Value("${app.rate-limit.requests-per-second:3}") int requestsPerSecond) {
        this(requestsPerSecond, Clock.systemUTC());
    }

    /** Visible for tests: deterministic clock, no Spring context. */
    RateLimitFilter(int requestsPerSecond, Clock clock) {
        this.rateLimiter = new SlidingWindowRateLimiter(requestsPerSecond, WINDOW_MILLIS, clock);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // CORS preflights must not burn the caller's budget.
        return "OPTIONS".equalsIgnoreCase(request.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        SlidingWindowRateLimiter.Decision decision = rateLimiter.tryAcquire(resolveKey(request));
        if (!decision.allowed()) {
            writeTooManyRequests(response, decision.retryAfterMillis());
            return;
        }
        filterChain.doFilter(request, response);
    }

    private String resolveKey(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken)) {
            return "user:" + authentication.getName();
        }
        // No trusted proxy in front of the app; X-Forwarded-For would be client-spoofable here.
        return "ip:" + request.getRemoteAddr();
    }

    private void writeTooManyRequests(HttpServletResponse response, long retryAfterMillis) throws IOException {
        response.setStatus(429);
        response.setContentType("application/json");
        response.setHeader("Retry-After", Long.toString(Math.max(1, (retryAfterMillis + 999) / 1000)));
        response.getWriter().write("{\"status\":429,\"message\":\"Too many requests. Please try again shortly."
                + "\",\"timeStamp\":" + System.currentTimeMillis() + "}");
    }

    /** Scheduled sweep so one-shot clients cannot grow the key map unbounded. */
    @Scheduled(fixedRate = 300_000)
    public void evictStaleKeys() {
        rateLimiter.evictStale();
    }
}
