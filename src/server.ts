import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

// Impossible to run this mode unaware: the banner goes to stderr before the
// server binds to a port.
if (env.LAB_MODE === 'vulnerable') {
  console.error(
    [
      '',
      '############################################################',
      '#  WARNING: LAB_MODE=vulnerable                            #',
      '#                                                          #',
      '#  This process serves intentionally vulnerable endpoints  #',
      '#  (IDOR, mass assignment, excessive data exposure) for    #',
      '#  educational purposes only.                              #',
      '#                                                          #',
      '#  Only run this on localhost, on a machine you own.       #',
      '#  Never expose it to a network or the public internet.    #',
      '############################################################',
      '',
    ].join('\n'),
  );
}

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Listening on http://${env.HOST}:${env.PORT} (LAB_MODE=${env.LAB_MODE})`);
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
