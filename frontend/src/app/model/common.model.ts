/** Mirrors the backend ErrorResponseDTO from the global exception handler. */
export interface ErrorResponse {
  status: number;
  message: string;
  timeStamp: number;
}

/**
 * Body of the hand-rolled success/error strings (AssetUtils.getResponseEntity).
 * The key really is misspelled on the backend — do not "fix" it here.
 * Returned by: delete endpoints, currency writes, user patches, forgot/change-password.
 */
export interface MessageResponse {
  messag: string;
}
