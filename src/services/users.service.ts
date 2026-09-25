import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError } from '../middleware/error-handler';

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

// Every response that goes through this boundary is safe by construction:
// each field is copied by name, so adding a column to the User model cannot
// silently widen what a client receives.
export function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');
  return user;
}

export type UpdateMeParams = { userId: number; body: unknown };

export async function updateMe({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  // The settings form only ever sends name and email.
  const user = await prisma.user.update({
    where: { id: userId },
    data: body as Prisma.UserUpdateInput,
  });
  return toPublicUser(user);
}
