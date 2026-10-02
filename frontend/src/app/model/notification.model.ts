/**
 * One server push over /ws/notifications. `timestamp` is an ISO-8601 UTC string
 * produced by the backend (`Instant.toString()`) — validated with `Date.parse`
 * before a notification is stored.
 */
export interface Notification {
  message: string;
  timestamp: string;
}
