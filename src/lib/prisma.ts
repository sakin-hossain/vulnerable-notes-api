import { PrismaClient } from '@prisma/client';

// Reuse a single client across `tsx watch` reloads in dev, otherwise every
// file change opens a fresh pool of SQLite connections.
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    // Warnings only. Prisma's own error logger reprints the offending query
    // and the calling source to stderr, which during a screen recording would
    // show the vulnerable function before it has been explained. Errors are
    // not lost: the centralised handler logs every 5xx with its stack.
    log: ['warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
