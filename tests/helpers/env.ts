/**
 * Test environment bootstrap.
 *
 * Every other helper imports this module FIRST, before anything from `src/`,
 * because `src/config/env.ts` reads and freezes `process.env` the moment it is
 * loaded. `dotenv` does not overwrite variables that are already set, so the
 * values assigned here win over the developer's `.env`.
 *
 * The suite therefore runs against `prisma/test.db` and never touches the
 * seeded lab database in `prisma/dev.db`.
 */

export const TEST_DATABASE_URL = 'file:./test.db';
export const TEST_JWT_SECRET = 'test-only-not-a-real-secret-0123456789abcdef';
export const TEST_JWT_EXPIRES_IN = '1h';
export const TEST_BCRYPT_COST = '4';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.JWT_EXPIRES_IN = TEST_JWT_EXPIRES_IN;
process.env.BCRYPT_COST = TEST_BCRYPT_COST;
process.env.NODE_ENV = 'test';
// Each test mounts its app with an explicit `labMode`, so this only decides
// the default for anything that reads `env.LAB_MODE` directly.
process.env.LAB_MODE = 'secure';
