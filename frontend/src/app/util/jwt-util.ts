import type { Role } from 'model/user.model';

/** Claims the backend puts in its JWTs (sub = email, exp in seconds). */
export interface JwtClaims {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
  /** Token type; 'access' on tokens from the refresh-rotation backend. Optional so legacy tokens without it still decode. */
  typ?: 'access';
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decode the payload of a JWT without verifying the signature; null when malformed. */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }
    return JSON.parse(base64UrlDecode(payload)) as JwtClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: JwtClaims, now: number = Date.now()): boolean {
  return claims.exp * 1000 <= now;
}
