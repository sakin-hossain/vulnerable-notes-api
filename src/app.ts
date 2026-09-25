import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { createAuthRouter } from './routes/auth.routes';
import { createNotesRouter } from './routes/notes.routes';
import { createUsersRouter } from './routes/users.routes';

// `createApp` never calls `listen`, so Supertest drives it in-process.
export function createApp(): Express {
  const app = express();

  // Version fingerprinting is free reconnaissance for an attacker.
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter());
  app.use('/api/users', createUsersRouter());
  app.use('/api/notes', createNotesRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
