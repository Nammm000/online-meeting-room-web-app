package tech.getarrays.meetingroom.util;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class SlidingWindowRateLimiterTest {

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

    private static MutableClock clockAtZero() {
        return new MutableClock(Instant.ofEpochMilli(0));
    }

    private static void fill(SlidingWindowRateLimiter limiter, String key, int times) {
        for (int i = 0; i < times; i++) {
            assertThat(limiter.tryAcquire(key).allowed()).isTrue();
        }
    }

    @Test
    void allowsFirstThreeThenRejectsFourth() {
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, 1000, clockAtZero());

        fill(limiter, "k", 3);
        assertThat(limiter.tryAcquire("k").allowed()).isFalse();
    }

    @Test
    void windowSlidesAndAdmitsAgain() {
        MutableClock clock = clockAtZero();
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, 1000, clock);
        fill(limiter, "k", 3);

        clock.advanceMillis(500);
        assertThat(limiter.tryAcquire("k").allowed()).isFalse();

        // A timestamp is stale once it is a full window old: the burst at t0 leaves
        // the window exactly at t0+1000.
        clock.advanceMillis(500);
        assertThat(limiter.tryAcquire("k").allowed()).isTrue();
    }

    @Test
    void retryAfterComputedFromOldestTimestamp() {
        MutableClock clock = clockAtZero();
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, 1000, clock);
        fill(limiter, "k", 3);

        clock.advanceMillis(400);
        SlidingWindowRateLimiter.Decision decision = limiter.tryAcquire("k");

        assertThat(decision.allowed()).isFalse();
        // Oldest timestamp is t0; it expires at t0+1000, i.e. 600ms from now.
        assertThat(decision.retryAfterMillis()).isEqualTo(600);
    }

    @Test
    void independentKeysHaveIndependentWindows() {
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, 1000, clockAtZero());

        fill(limiter, "user:a@example.com", 3);
        assertThat(limiter.tryAcquire("user:a@example.com").allowed()).isFalse();
        assertThat(limiter.tryAcquire("user:b@example.com").allowed()).isTrue();
    }

    @Test
    void rejectedRequestsDoNotConsumeSlots() {
        MutableClock clock = clockAtZero();
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, 1000, clock);
        fill(limiter, "k", 3);

        for (int i = 0; i < 10; i++) {
            assertThat(limiter.tryAcquire("k").allowed()).isFalse();
        }

        clock.advanceMillis(1000);
        // The rejections logged nothing, so the window only holds the initial burst.
        assertThat(limiter.tryAcquire("k").allowed()).isTrue();
    }

    @Test
    void evictStaleRemovesIdleKeys() {
        MutableClock clock = clockAtZero();
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, 1000, clock);
        fill(limiter, "user:a@example.com", 1);
        clock.advanceMillis(100);
        fill(limiter, "ip:127.0.0.1", 1);
        assertThat(limiter.keyCount()).isEqualTo(2);

        clock.advanceMillis(1000);
        limiter.evictStale();

        assertThat(limiter.keyCount()).isZero();
        assertThat(limiter.tryAcquire("user:a@example.com").allowed()).isTrue();
    }
}
