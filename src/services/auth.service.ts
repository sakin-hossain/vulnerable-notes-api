import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ConflictError, UnauthorizedError } from '../middleware/error-handler';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import { signAccessToken } from '../utils/jwt';
import { toPublicUser, type PublicUser } from './users.service';

// Precomputed once at module load so a failed login always pays for one
// bcrypt compare, whether or not the email exists. Without this, an unknown
// email would return faster than a wrong password, and that timing gap is
// enough to enumerate registered accounts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_COST);

export type AuthResult = { user: PublicUser; token: string };

export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('Email is already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash },
  });

  const token = signAccessToken({ id: user.id });
  return { user: toPublicUser(user), token };
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  // Identical response for "no such user" and "wrong password" — a
  // different message or status for either case is a user-enumeration bug.
  if (!user || !passwordMatches) {
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const token = signAccessToken({ id: user.id });
  return { user: toPublicUser(user), token };
}
