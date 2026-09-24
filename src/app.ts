import express, { type Express } from 'express';
import { env, type LabMode } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { createAuthRouter } from './routes/auth.routes';
import { createNotesRouter } from './routes/notes.routes';
import { createUsersRouter } from './routes/users.routes';

export type CreateAppOptions = { labMode?: LabMode };

// Takes the mode as an option (rather than reading `env` directly) so tests
// can mount a `vulnerable` app and a `secure` app side by side against the
// same database in a single Vitest run.
export function createApp({ labMode = env.LAB_MODE }: CreateAppOptions = {}): Express {
  const app = express();

  // Version fingerprinting is free reconnaissance for an attacker.
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', labMode });
  });

  app.use('/api/auth', createAuthRouter());
  app.use('/api/users', createUsersRouter(labMode));
  app.use('/api/notes', createNotesRouter(labMode));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
