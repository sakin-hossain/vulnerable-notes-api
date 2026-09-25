import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

// Idempotent lab seed — safe to re-run with `pnpm db:seed` or `pnpm db:reset`.
// Both accounts use the same lab-only password: Password123!
const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 10);

const prisma = new PrismaClient();

async function resetDatabase(): Promise<void> {
  // Children first so the foreign key constraint never blocks the delete.
  await prisma.note.deleteMany();
  await prisma.user.deleteMany();

  // Reset SQLite's autoincrement counters so re-seeding reproduces the same
  // ids every time (Alice's notes 1-3, Bob's notes 4-6). The sqlite_sequence
  // table only exists once an AUTOINCREMENT column has been used, so this is
  // guarded in case it hasn't been created yet.
  try {
    await prisma.$executeRaw`DELETE FROM sqlite_sequence WHERE name IN ('User', 'Note')`;
  } catch {
    // Table doesn't exist yet on a brand-new database — nothing to reset.
  }
}

async function main(): Promise<void> {
  await resetDatabase();

  const passwordHash = await bcrypt.hash('Password123!', BCRYPT_COST);

  const alice = await prisma.user.create({
    data: {
      name: 'Alice',
      email: 'alice@example.local',
      passwordHash,
      role: 'USER',
      resetToken: 'lab-not-a-real-secret-reset-token-alice',
    },
  });

  const aliceNotes = await prisma.note.createManyAndReturn({
    data: [
      {
        title: 'My private deployment checklist',
        content: 'Draft steps for the next release.',
        userId: alice.id,
      },
      {
        title: 'Internal test note',
        content: 'Reminder to check the staging environment.',
        userId: alice.id,
      },
      {
        title: 'Weekend reading list',
        content: 'A few articles to read this weekend.',
        userId: alice.id,
      },
    ],
  });

  const bob = await prisma.user.create({
    data: {
      name: 'Bob',
      email: 'bob@example.local',
      passwordHash,
      role: 'USER',
      resetToken: 'lab-not-a-real-secret-reset-token-bob',
    },
  });

  const bobNotes = await prisma.note.createManyAndReturn({
    data: [
      {
        title: 'Private project notes',
        content: 'Private release notes — production migration scheduled Friday.',
        userId: bob.id,
      },
      {
        title: 'Database migration plan',
        content: 'Outline for moving to the new schema.',
        userId: bob.id,
      },
      {
        title: 'Interview feedback draft',
        content: 'Notes to write up after the interview.',
        userId: bob.id,
      },
    ],
  });

  console.log('\nSeed complete. Note ownership:\n');
  console.table(
    [...aliceNotes, ...bobNotes].map((note) => ({
      noteId: note.id,
      owner: note.userId === alice.id ? alice.name : bob.name,
      title: note.title,
    })),
  );
  console.log(`\nAlice: ${alice.email} / Password123! (userId ${alice.id})`);
  console.log(`Bob:   ${bob.email} / Password123! (userId ${bob.id})`);
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
