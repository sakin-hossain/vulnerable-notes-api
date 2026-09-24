import { z } from 'zod';

// `strictObject` REJECTS unknown keys with a 400 rather than silently
// stripping them, so an attempted `role` injection on this endpoint shows up
// as a validation failure in the logs instead of failing silently.
export const updateMeSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().toLowerCase().optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'At least one of name or email is required',
  });

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
