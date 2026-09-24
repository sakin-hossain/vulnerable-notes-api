import { z } from 'zod';

// bcrypt only hashes the first 72 bytes of a password and silently ignores
// the rest, so the accepted length must be capped at 72 to match what
// actually gets hashed.
export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(72),
});

export const loginSchema = z.strictObject({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
