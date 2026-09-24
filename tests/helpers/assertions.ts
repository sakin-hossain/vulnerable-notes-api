import { expect } from 'vitest';

const PUBLIC_USER_KEYS = ['createdAt', 'email', 'id', 'name', 'role'] as const;

/** The exact key set a `PublicUser` may ever expose. */
export function expectPublicUserShape(user: unknown): void {
  expect(user).toBeTypeOf('object');
  expect(Object.keys(user as object).sort()).toEqual([...PUBLIC_USER_KEYS]);
}

function collectKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.push(key);
      collectKeys(nested, found);
    }
  }
  return found;
}

/** No response may carry a stack trace, a source location, or a server path. */
export function expectNoLeakedInternals(body: unknown): void {
  expect(collectKeys(body)).not.toContain('stack');

  const serialized = JSON.stringify(body) ?? '';
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toContain(process.cwd());
  expect(serialized).not.toMatch(/\.(?:ts|js):\d+/);
  expect(serialized).not.toMatch(/\bat \w+[^"]*\(/);
}

/** Every 4xx/5xx body must be the spec §9 envelope and nothing more. */
export function expectErrorEnvelope(body: any, code?: string): void {
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error.message).toBe('string');
  for (const key of Object.keys(body.error)) {
    expect(['message', 'code', 'details']).toContain(key);
  }
  if (code !== undefined) {
    expect(body.error.code).toBe(code);
  }
  expectNoLeakedInternals(body);
}
