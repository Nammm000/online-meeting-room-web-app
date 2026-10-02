/**
 * Normalize an HttpErrorResponse body into a display string. The backend has
 * three shapes: the global handler's `{status, message, timeStamp}`, the
 * hand-rolled `{"messag": "..."}` strings, and bare strings (e.g. "User not
 * created, come again later!").
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error !== null && typeof error === 'object' && 'error' in error) {
    const body = (error as { error: unknown }).error;
    if (typeof body === 'string' && body.trim() !== '') {
      return body;
    }
    if (body !== null && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const message = record['message'] ?? record['messag'];
      if (typeof message === 'string' && message.trim() !== '') {
        return message;
      }
    }
  }
  return fallback;
}
