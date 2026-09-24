import { Router } from 'express';
import { loginSchema, registerSchema } from '../schemas/auth.schema';
import { loginUser, registerUser } from '../services/auth.service';

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const input = registerSchema.parse(req.body);
    const { user, token } = await registerUser(input);
    res.status(201).json({ user, token });
  });

  router.post('/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { user, token } = await loginUser(input);
    res.status(200).json({ user, token });
  });

  return router;
}
