import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Listening on http://${env.HOST}:${env.PORT}`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\nReceived ${signal}, shutting down...`);
  server.close((closeErr) => {
    if (closeErr) console.error('Error while closing HTTP server:', closeErr);

    prisma
      .$disconnect()
      .catch((disconnectErr: unknown) =>
        console.error('Error disconnecting Prisma:', disconnectErr),
      )
      .finally(() => process.exit(closeErr ? 1 : 0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
