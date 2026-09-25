import { Router } from 'express';
import { requireAuth, requireUser } from '../middleware/auth';
import { createNoteSchema, noteIdParamSchema, updateNoteSchema } from '../schemas/note.schema';
import {
  createNote,
  deleteNote,
  getNoteById,
  listNotes,
  updateNote,
} from '../services/notes.service';

export function createNotesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { id: userId } = requireUser(req);
    const notes = await listNotes(userId);
    res.status(200).json({ notes });
  });

  router.post('/', async (req, res) => {
    const { id: userId } = requireUser(req);
    const input = createNoteSchema.parse(req.body);
    const note = await createNote({ userId, input });
    res.status(201).json({ note });
  });

  router.get('/:id', async (req, res) => {
    const { id: userId } = requireUser(req);
    const { id: noteId } = noteIdParamSchema.parse(req.params);
    const note = await getNoteById({ noteId, userId });
    res.status(200).json({ note });
  });

  router.patch('/:id', async (req, res) => {
    const { id: userId } = requireUser(req);
    const { id: noteId } = noteIdParamSchema.parse(req.params);
    const input = updateNoteSchema.parse(req.body);
    const note = await updateNote({ noteId, userId, input });
    res.status(200).json({ note });
  });

  router.delete('/:id', async (req, res) => {
    const { id: userId } = requireUser(req);
    const { id: noteId } = noteIdParamSchema.parse(req.params);
    await deleteNote({ noteId, userId });
    res.status(204).send();
  });

  return router;
}
