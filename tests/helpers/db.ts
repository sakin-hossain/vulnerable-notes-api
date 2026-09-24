import './env';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { prisma } from '../../src/lib/prisma';

export { prisma };

let schemaApplied: Promise<void> | null = null;

/**
 * Applies `prisma/schema.prisma` to the dedicated test database.
 *
 * Plain `db push` only — never `--force-reset` / `migrate reset`, because the
 * destructive Prisma commands are not safe to run unattended. The test DB is a
 * separate file from the lab's `dev.db`, and rows are cleared per test by
 * `resetDb()`.
 */
export function ensureTestDatabase(): Promise<void> {
  schemaApplied ??= new Promise<void>((resolve, reject) => {
    const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma');
    try {
      execFileSync(prismaBin, ['db', 'push', '--skip-generate'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      });
      resolve();
    } catch (err: any) {
      const stderr = err?.stderr?.toString?.() ?? '';
      const stdout = err?.stdout?.toString?.() ?? '';
      reject(new Error(`prisma db push failed for the test database:\n${stdout}\n${stderr}`));
    }
  });

  return schemaApplied;
}

/** Children first, so the Note -> User foreign key never blocks the delete. */
export async function resetDb(): Promise<void> {
  await prisma.note.deleteMany();
  await prisma.user.deleteMany();
}
