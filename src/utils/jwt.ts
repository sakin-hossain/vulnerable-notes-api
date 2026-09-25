import jwt from 'jsonwebtoken';
import { env } from '../config/env';

// JWT handling is correct in both lab modes — the lesson in this project is
// authorization and data exposure, not broken authentication. A future lab in
// the series covers JWT-specific flaws; nothing here is weakened on purpose.

const ISSUER = 'vulnerable-notes-api';

// The token carries an identifier and nothing else. Name, email and role are
// read from the database on each request, so putting them in the payload would
// add PII to a value the client can decode, and let a stale role linger in a
// token that is still within its expiry window.
export type JwtPayload = { sub: number };

export function signAccessToken(user: { id: number }): string {
  const options = {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: ISSUER,
  } as jwt.SignOptions;

  return jwt.sign({ sub: user.id }, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  // Both the algorithm and the issuer are pinned. Without the algorithm
  // allowlist an attacker could present an `alg: none` token; without the
  // issuer check, a token minted by any other service sharing this secret
  // would be accepted here.
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
  });

  if (typeof decoded !== 'object' || decoded === null || typeof decoded.sub !== 'number') {
    throw new Error('Malformed token payload');
  }

  return { sub: decoded.sub };
}
