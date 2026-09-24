import 'dotenv/config';
import { z } from 'zod';

export type LabMode = 'vulnerable' | 'secure';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+$|^\d+[smhdwy]$/, 'JWT_EXPIRES_IN must look like 3600, 30m, 1h or 7d')
    .default('1h'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  // Fails closed: an unset LAB_MODE gives you the fixed build, never the
  // vulnerable one. The lab's .env opts in to "vulnerable" explicitly.
  LAB_MODE: z.enum(['vulnerable', 'secure']).default('secure'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:\n');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    console.error('\nCheck your .env file against .env.example and try again.');
    process.exit(1);
  }

  // A deliberately vulnerable build has no business running as "production".
  if (parsed.data.NODE_ENV === 'production' && parsed.data.LAB_MODE === 'vulnerable') {
    console.error(
      'Refusing to start: LAB_MODE=vulnerable with NODE_ENV=production.\n' +
        'The vulnerable build is a teaching aid for localhost only.',
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = Object.freeze(loadEnv());

export type Env = typeof env;
