/**
 * Authentication is deliberately NOT one of this lab's three vulnerabilities.
 * This suite runs the identical checks against both builds to prove it: if a
 * test here ever passes in one mode and fails in the other, the lab has grown
 * a fourth bug.
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  expectErrorEnvelope,
  expectNoLeakedInternals,
  expectPublicUserShape,
} from './helpers/assertions';
import { makeApp } from './helpers/app';
import {
  ALICE,
  BOB,
  algNoneTokenFor,
  authHeader,
  createNote,
  expiredTokenFor,
  missingIssuerTokenFor,
  registerUser,
  validTokenFor,
  wrongIssuerTokenFor,
  wrongSecretTokenFor,
} from './helpers/auth';
import { ensureTestDatabase, prisma, resetDb } from './helpers/db';

beforeAll(async () => {
  await ensureTestDatabase();
});

beforeEach(async () => {
  await resetDb();
});

describe('auth', () => {
  const app = makeApp();

  describe('A1 — registration returns a token and only public user fields', () => {
    it('returns 201 with a token and a user object', async () => {
      const res = await request(app).post('/api/auth/register').send(ALICE);

      expect(res.status).toBe(201);
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.split('.')).toHaveLength(3);
      expect(res.body.user).toMatchObject({
        name: 'Alice',
        email: 'alice@example.local',
        role: 'USER',
      });
      expect(typeof res.body.user.id).toBe('number');
    });

    it('exposes exactly [createdAt, email, id, name, role] and nothing else', async () => {
      const res = await request(app).post('/api/auth/register').send(ALICE);

      expectPublicUserShape(res.body.user);
    });

    it('never leaks passwordHash or resetToken in a register or login response', async () => {
      const registered = await request(app).post('/api/auth/register').send(ALICE);
      const loggedIn = await request(app)
        .post('/api/auth/login')
        .send({ email: ALICE.email, password: ALICE.password });

      for (const res of [registered, loggedIn]) {
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain('passwordHash');
        expect(serialized).not.toContain('resetToken');
        expect(serialized).not.toContain(ALICE.password);
      }
    });
  });

  describe('A2 — passwords are stored as bcrypt hashes, never as text', () => {
    it('stores a bcrypt hash that verifies against the original password', async () => {
      await registerUser(app, ALICE);

      const stored = await prisma.user.findUniqueOrThrow({ where: { email: ALICE.email } });
      expect(stored.passwordHash).not.toBe(ALICE.password);
      expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
      await expect(bcrypt.compare(ALICE.password, stored.passwordHash)).resolves.toBe(true);
      await expect(bcrypt.compare('not-the-password', stored.passwordHash)).resolves.toBe(false);
    });
  });

  describe('A3 — registration rejects duplicates and invalid input', () => {
    it('rejects a second registration for the same email with 409', async () => {
      await registerUser(app, ALICE);

      const res = await request(app).post('/api/auth/register').send(ALICE);

      expect(res.status).toBe(409);
      expectErrorEnvelope(res.body, 'CONFLICT');
    });

    it('rejects a password shorter than 8 characters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...ALICE, password: 'short7!' });

      expect(res.status).toBe(400);
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
      expect(res.body.error.details.some((d: any) => d.path === 'password')).toBe(true);
    });

    it('rejects a malformed email address with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...ALICE, email: 'alice-at-example-dot-local' });

      expect(res.status).toBe(400);
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
      expect(res.body.error.details.some((d: any) => d.path === 'email')).toBe(true);
    });

    it('rejects a missing body with 400 VALIDATION_ERROR', async () => {
      const res = await request(app).post('/api/auth/register').send({});

      expect(res.status).toBe(400);
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
    });
  });

  describe('A4 — login issues a token that authenticates the next request', () => {
    it('returns 200 with a public user and a working token', async () => {
      await registerUser(app, ALICE);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ALICE.email, password: ALICE.password });

      expect(res.status).toBe(200);
      expectPublicUserShape(res.body.user);

      const authed = await request(app)
        .get('/api/notes')
        .set('Authorization', authHeader(res.body.token));

      expect(authed.status).toBe(200);
      expect(authed.body.notes).toEqual([]);
    });
  });

  describe('A5 — a failed login never reveals whether the account exists', () => {
    it('answers an unknown email and a wrong password identically', async () => {
      await registerUser(app, ALICE);

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ email: ALICE.email, password: 'WrongPassword123!' });
      const unknownEmail = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.local', password: ALICE.password });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expectErrorEnvelope(wrongPassword.body, 'INVALID_CREDENTIALS');
    });
  });

  describe('A6 — protected routes reject every broken or forged token', () => {
    const protectedRoutes = ['/api/users/me', '/api/notes'] as const;

    it.each(protectedRoutes)('rejects %s with no Authorization header', async (route) => {
      const res = await request(app).get(route);

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('rejects a malformed Authorization header', async () => {
      const { token } = await registerUser(app, ALICE);

      for (const header of ['', 'Bearer', 'Bearer ', 'Basic abc123', token]) {
        const res = await request(app).get('/api/users/me').set('Authorization', header);
        expect(res.status, `header: "${header}"`).toBe(401);
        expectNoLeakedInternals(res.body);
      }
    });

    it('rejects a token signed with the wrong secret', async () => {
      const { user } = await registerUser(app, ALICE);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', authHeader(wrongSecretTokenFor(user)));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('rejects an unsigned "alg: none" token', async () => {
      const { user } = await registerUser(app, ALICE);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', authHeader(algNoneTokenFor(user)));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('rejects an expired token', async () => {
      const { user } = await registerUser(app, ALICE);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', authHeader(expiredTokenFor(user)));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('accepts a hand-signed token that satisfies every pinned claim (control)', async () => {
      const { user } = await registerUser(app, ALICE);

      const res = await request(app)
        .get('/api/notes')
        .set('Authorization', authHeader(validTokenFor(user)));

      expect(res.status).toBe(200);
    });

    it('rejects a correctly signed token minted by a different issuer', async () => {
      const { user } = await registerUser(app, ALICE);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', authHeader(wrongIssuerTokenFor(user)));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('rejects a correctly signed token that carries no issuer claim', async () => {
      const { user } = await registerUser(app, ALICE);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', authHeader(missingIssuerTokenFor(user)));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('rejects garbage that is not a token at all', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', authHeader('not-a-jwt'));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });

    it('rejects a valid token whose user has been deleted', async () => {
      const { token, user } = await registerUser(app, ALICE);
      await prisma.user.delete({ where: { id: user.id } });

      const res = await request(app).get('/api/users/me').set('Authorization', authHeader(token));

      expect(res.status).toBe(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    });
  });

  describe('A8 — the health endpoint answers without a token', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('needs no authentication, so the operator can always probe liveness', async () => {
      const res = await request(app).get('/health').set('Authorization', 'Bearer nonsense');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('A7 — the notes list is scoped to the caller in both modes', () => {
    it('returns only the caller’s own notes', async () => {
      const alice = await registerUser(app, ALICE);
      const bob = await registerUser(app, BOB);
      await createNote(app, alice.token, { title: 'Alice note', content: 'alice content' });
      await createNote(app, bob.token, { title: 'Bob note', content: 'bob content' });

      const res = await request(app)
        .get('/api/notes')
        .set('Authorization', authHeader(alice.token));

      expect(res.status).toBe(200);
      expect(res.body.notes).toHaveLength(1);
      expect(res.body.notes[0]).toMatchObject({ title: 'Alice note', userId: alice.user.id });
      expect(JSON.stringify(res.body)).not.toContain('bob content');
    });
  });
});
