package tech.getarrays.meetingroom.dto.meeting;

/**
 * Lock/unlock payload. Locking only flips the DB flag — the token gate (no
 * minting for anyone not already JOINED) is the entire enforcement.
 */
public record LockRequest(Boolean locked) {
}
