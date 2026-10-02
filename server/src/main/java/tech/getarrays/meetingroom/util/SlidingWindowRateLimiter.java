package tech.getarrays.meetingroom.util;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Sliding-window log rate limiter: at most {@code limit} acquisitions per key in any
 * rolling {@code windowMillis} window. Rejected attempts never log a timestamp, so a
 * client hammering the API cannot keep itself blocked. In-memory and single-instance
 * by design; deliberately not a Spring bean so the owning filter can hand it a
 * deterministic {@link Clock} in tests.
 */
public class SlidingWindowRateLimiter {

    /** Outcome of one acquisition attempt; retryAfterMillis is only meaningful when rejected. */
    public record Decision(boolean allowed, long retryAfterMillis) {}

    private final int limit;
    private final long windowMillis;
    private final Clock clock;
    private final ConcurrentMap<String, Deque<Long>> timestampsByKey = new ConcurrentHashMap<>();

    public SlidingWindowRateLimiter(int limit, long windowMillis, Clock clock) {
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be >= 1");
        }
        if (windowMillis < 1) {
            throw new IllegalArgumentException("windowMillis must be >= 1");
        }
        this.limit = limit;
        this.windowMillis = windowMillis;
        this.clock = clock;
    }

    /**
     * Admits {@code key} while it holds fewer than {@code limit} acquisitions inside the
     * current window; otherwise rejects and reports how long until the oldest timestamp
     * leaves the window. A timestamp is stale once it is {@code windowMillis} old or older.
     * Synchronized on the per-key deque — a coarse per-key lock is plenty for a single
     * instance with personal-app traffic.
     */
    public Decision tryAcquire(String key) {
        long now = clock.millis();
        Deque<Long> timestamps = timestampsByKey.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (timestamps) {
            while (!timestamps.isEmpty() && timestamps.peekFirst() <= now - windowMillis) {
                timestamps.removeFirst();
            }
            if (timestamps.size() < limit) {
                timestamps.addLast(now);
                return new Decision(true, 0);
            }
            long retryAfterMillis = Math.max(0, timestamps.peekFirst() + windowMillis - now);
            return new Decision(false, retryAfterMillis);
        }
    }

    /** Drops keys with no acquisitions left in the window; schedule this periodically so one-shot clients cannot grow the map unbounded. */
    public void evictStale() {
        long now = clock.millis();
        timestampsByKey.entrySet().removeIf(entry -> {
            Deque<Long> timestamps = entry.getValue();
            synchronized (timestamps) {
                timestamps.removeIf(timestamp -> timestamp <= now - windowMillis);
                return timestamps.isEmpty();
            }
        });
    }

    /** Visible for tests: number of currently tracked keys. */
    int keyCount() {
        return timestampsByKey.size();
    }
}
