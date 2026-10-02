import { decodeJwt, isExpired, type JwtClaims } from './jwt-util';

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(claims: Partial<JwtClaims> = {}): string {
  const full: JwtClaims = {
    sub: 'user@test.com',
    role: 'ROLE_USER',
    iat: 1000,
    exp: 9999999999,
    ...claims,
  };
  return `header.${base64Url(JSON.stringify(full))}.signature`;
}

describe('jwt-util', () => {
  it('decodes the payload claims of a valid token', () => {
    const claims = decodeJwt(makeJwt({ sub: 'a@b.c', role: 'ROLE_ADMIN' }));

    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('a@b.c');
    expect(claims!.role).toBe('ROLE_ADMIN');
  });

  it('keeps non-ASCII (UTF-8) subjects intact', () => {
    const claims = decodeJwt(makeJwt({ sub: 'người.dùng@test.com' }));

    expect(claims!.sub).toBe('người.dùng@test.com');
  });

  it('returns null for tokens without a payload segment', () => {
    expect(decodeJwt('garbage')).toBeNull();
  });

  it('returns null for an undecodable payload', () => {
    expect(decodeJwt('header.!!!.signature')).toBeNull();
  });

  it('treats exp at exactly now as expired', () => {
    const now = 1_750_000_000_000;
    const claims: JwtClaims = { sub: 'a@b.c', role: 'ROLE_USER', iat: 0, exp: now / 1000 };

    expect(isExpired(claims, now)).toBe(true);
    expect(isExpired(claims, now - 1)).toBe(false);
  });
});
