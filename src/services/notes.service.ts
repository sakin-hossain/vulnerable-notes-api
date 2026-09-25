import { prisma } from '../lib/prisma';
import { NotFoundError } from '../middleware/error-handler';
import type { CreateNoteInput, UpdateNoteInput } from '../schemas/note.schema';

export async function listNotes(userId: number) {
  return prisma.note.findMany({
    where: { userId },
    // Seeded notes share a timestamp to the millisecond, so createdAt alone
    // is not a total order. The id tiebreak keeps the list deterministic.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export type CreateNoteParams = { userId: number; input: CreateNoteInput };

export async function createNote({ userId, input }: CreateNoteParams) {
  // Ownership comes from the authenticated request, never from the request
  // body — otherwise a client could create a note under someone else's id.
  return prisma.note.create({
    data: { title: input.title, content: input.content, userId },
  });
}

export type GetNoteParams = { noteId: number; userId: number };

export async function getNoteById({ noteId, userId }: GetNoteParams) {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  // 404, not 403: a 403 would confirm the id exists but isn't the caller's,
  // turning the status code itself into an existence oracle.
  if (!note) throw new NotFoundError('Note not found');
  return note;
}

export type UpdateNoteParams = { noteId: number; userId: number; input: UpdateNoteInput };

export async function updateNote({ noteId, userId, input }: UpdateNoteParams) {
  const [note] = await prisma.note.updateManyAndReturn({
    where: { id: noteId, userId },
    data: { title: input.title, content: input.content },
  });
  if (!note) throw new NotFoundError('Note not found');
  return note;
}

export type DeleteNoteParams = { noteId: number; userId: number };

export async function deleteNote({ noteId, userId }: DeleteNoteParams): Promise<void> {
  const result = await prisma.note.deleteMany({ where: { id: noteId, userId } });
  if (result.count === 0) throw new NotFoundError('Note not found');
}
