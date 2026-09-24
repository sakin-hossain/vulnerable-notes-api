import './env';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { TEST_JWT_SECRET } from './env';

export type Credentials = { name: string; email: string; password: string };

export const ALICE: Credentials = {
  name: 'Alice',
  email: 'alice@example.local',
  password: 'Password123!',
};

export const BOB: Credentials = {
  name: 'Bob',
  email: 'bob@example.local',
  password: 'Password123!',
};

export type AuthedUser = {
  token: string;
  user: { id: number; name: string; email: string; role: string; createdAt: string };
};

export function authHeader(token: string): string {
  return `Bearer ${token}`;
}

export async function registerUser(app: Express, creds: Credentials): Promise<AuthedUser> {
  const res = await request(app).post('/api/auth/register').send(creds);
  if (res.status !== 201) {
    throw new Error(`register(${creds.email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, user: res.body.user };
}

export async function loginUser(
  app: Express,
  creds: Pick<Credentials, 'email' | 'password'>,
): Promise<AuthedUser> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: creds.email, password: creds.password });
  if (res.status !== 200) {
    throw new Error(`login(${creds.email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, user: res.body.user };
}

export type NoteInput = { title: string; content: string };

export async function createNote(
  app: Express,
  token: string,
  input: NoteInput,
): Promise<{ id: number; title: string; content: string; userId: number }> {
  const res = await request(app)
    .post('/api/notes')
    .set('Authorization', authHeader(token))
    .send(input);
  if (res.status !== 201) {
    throw new Error(
      `createNote("${input.title}") failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.note;
}

/**
 * The app pins both the algorithm and the issuer, and its payload is now
 * `{ sub }` alone. These factories each break exactly ONE of those rules, so a
 * failing assertion points at a single cause.
 */
const ISSUER = 'vulnerable-node-api-lab';

type TokenSubject = { id: number };

/**
 * Positive control: a hand-signed token that satisfies every pinned claim.
 * If this one is rejected, the forged-token tests below prove nothing.
 */
export function validTokenFor(user: TokenSubject): string {
  return jwt.sign({ sub: user.id }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    issuer: ISSUER,
  });
}

/** A structurally valid, correctly issued token signed with a DIFFERENT secret. */
export function wrongSecretTokenFor(user: TokenSubject): string {
  return jwt.sign({ sub: user.id }, 'a-different-secret-that-is-also-32-chars-long', {
    algorithm: 'HS256',
    expiresIn: '1h',
    issuer: ISSUER,
  });
}

/** A correctly signed and issued token whose `exp` is already in the past. */
export function expiredTokenFor(user: TokenSubject): string {
  return jwt.sign({ sub: user.id }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '-1h',
    issuer: ISSUER,
  });
}

/** Right secret, right algorithm, unexpired — but minted by another service. */
export function wrongIssuerTokenFor(user: TokenSubject): string {
  return jwt.sign({ sub: user.id }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    issuer: 'some-other-service',
  });
}

/** Right secret, right algorithm, unexpired — but carrying no `iss` claim. */
export function missingIssuerTokenFor(user: TokenSubject): string {
  return jwt.sign({ sub: user.id }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

/**
 * The classic algorithm-confusion attack: an unsigned token claiming
 * `alg: none`. Hand-built, because `jsonwebtoken` refuses to produce one. The
 * issuer is correct so the algorithm allowlist is the only thing rejecting it.
 */
export function algNoneTokenFor(user: TokenSubject): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'none', typ: 'JWT' });
  const body = encode({ sub: user.id, iss: ISSUER, iat: now, exp: now + 3600 });
  return `${header}.${body}.`;
}
