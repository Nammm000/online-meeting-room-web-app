package tech.getarrays.meetingroom.constants;

/**
 * Cache names for the Redis-backed Spring Cache (configuration/RedisCacheConfig,
 * docs/redis.md). The plural/singular pair mirrors the two read endpoints of the
 * PDF domain; every annotation site uses these constants, never string literals.
 */
public class CacheConstants {

    /** Paged PDF lists, key {@code <email>:<page>:<size>}. */
    public static final String CACHE_USER_PDFS = "user-pdf-files";

    /** Single PDF content by id, key {@code <email>:<id>}. */
    public static final String CACHE_USER_PDF = "user-pdf-file";

    private CacheConstants() {
    }
}
