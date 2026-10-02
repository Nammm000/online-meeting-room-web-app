/** POST /auth/login body. */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * POST /auth/login, /auth/signup and /auth/refresh response (AuthenticationResponse record).
 * The refresh token is NOT in the body: it arrives as the HttpOnly
 * `asset-manager.refreshToken` cookie (SameSite=Strict, Path=/auth), unreadable from
 * JS — /auth/refresh and /auth/logout take no body and authenticate via that cookie.
 */
export interface AuthenticationResponse {
  accessToken: string;
}

/** POST /auth/signup body (SignupDTO). */
export interface SignupRequest {
  name: string;
  email: string;
  phone: string;
  password: string;
}

/** POST /auth/forgot-password body. */
export interface EmailRequest {
  email: string;
}

/** POST /auth/logout response (LogoutResponse record). */
export interface LogoutResponse {
  message: string;
}

/** POST /auth/change-password body. */
export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}
