import { Router } from 'express';
import { requireAuth, requireUser } from '../middleware/auth';
import { getMe, updateMe } from '../services/users.service';

export function createUsersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', async (req, res) => {
    const { id: userId } = requireUser(req);
    const user = await getMe(userId);
    res.status(200).json({ user });
  });

  router.patch('/me', async (req, res) => {
    const { id: userId } = requireUser(req);
    const user = await updateMe({ userId, body: req.body });
    res.status(200).json({ user });
  });

  return router;
}
