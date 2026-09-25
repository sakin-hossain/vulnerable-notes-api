import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError } from '../middleware/error-handler';
import { updateMeSchema } from '../schemas/user.schema';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

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

export async function getMe(userId: number): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
  if (!user) throw new NotFoundError('User not found');
  return toPublicUser(user);
}

export type UpdateMeParams = { userId: number; body: unknown };

export async function updateMe({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  const input = updateMeSchema.parse(body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name, email: input.email }, // explicit mapping, never a spread
    select: publicUserSelect,
  });
  return toPublicUser(user);
}
