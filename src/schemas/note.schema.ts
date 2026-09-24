import { z } from 'zod';

export const createNoteSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  content: z.string().min(1).max(10_000),
});

export const updateNoteSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().min(1).max(10_000).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: 'At least one of title or content is required',
  });

// Coerces the route param to a number so an invalid id (e.g. "abc") fails
// validation with a 400, instead of reaching Prisma and blowing up as a 500.
export const noteIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
