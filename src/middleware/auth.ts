import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { verifyAccessToken, type JwtPayload } from '../utils/jwt';
import { ForbiddenError, UnauthorizedError } from './error-handler';

// Authentication is correct here on purpose: this lab's three vulnerabilities
// are authorization and data-exposure bugs, not ways to bypass login.

export type AuthenticatedUser = { id: number; email: string; role: string };

const BEARER_PREFIX = 'Bearer ';

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new UnauthorizedError('Missing or malformed Authorization header'));
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    next(new UnauthorizedError('Missing bearer token'));
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
    return;
  }

  try {
    // Role is read fresh from the database on every request instead of being
    // trusted from the token, so a role change takes effect immediately.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      next(new UnauthorizedError('User no longer exists'));
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }
  return req.user;
}

// Intentionally not mounted on any route. This lab has no admin-only
// endpoint, so escalating to ADMIN grants no extra capability — the finding is
// that an unprivileged user can rewrite a field the server alone should own.
// Keeping the guard here shows what the missing half of that story looks like.
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (requireUser(req).role !== 'ADMIN') {
    next(new ForbiddenError('Admin access required'));
    return;
  }
  next();
}
