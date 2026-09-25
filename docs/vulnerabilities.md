# Vulnerabilities Guide

This document details the three intentional vulnerabilities in the Vulnerable Notes API, their root causes, how to reproduce them, and how they are fixed.

All reproduction commands target `http://127.0.0.1:3000` (adjust the host/port if needed).

---

## V1 — Broken Object Level Authorization (IDOR)

**OWASP API Security:** [API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0x01-index/)

### Affected Route

`GET /api/notes/:id`

### Root Cause

The endpoint queries for the note by ID without checking ownership. Authentication (is the user logged in) is confused with authorization (does the user own this resource).

```typescript
// Vulnerable: no ownership check
const note = await prisma.note.findUnique({ where: { id: noteId } });
```

The handler receives `userId` from the request context but never uses it:

```typescript
export type GetNoteParams = { noteId: number; userId: number };

export async function getNoteByIdInsecure({ noteId }: GetNoteParams) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) throw new NotFoundError('Note not found');
  return note;
}
```

Notice that `userId` is in the type signature but destructured away (ignored) — it is never used to filter the query.

### Why This Happens

In real development:

1. Authentication is added via middleware; "this endpoint is protected, only logged-in users can access it."
2. "Protected" is confused with "secure" — authentication and authorization are conflated.
3. The natural Prisma call for ID lookup is `findUnique`, which only accepts unique fields — it cannot express `{ id: noteId, userId }`.
4. Switching to `findFirst` (which allows multiple conditions) is not obvious.

### Vulnerable Code

```typescript
// src/services/notes.service.ts
export async function getNoteByIdInsecure({ noteId }: GetNoteParams) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) throw new NotFoundError('Note not found');
  return note;
}
```

### Local Reproduction

**Prerequisites:** Lab running in vulnerable mode, Alice and Bob seeded.

**Step 1: Register or get Alice's token**

```bash
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}'
```

Save the token:

```bash
ALICE_TOKEN="<paste-token-here>"
```

Or in one command:

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

echo "Alice token: $ALICE_TOKEN"
```

**Step 2: List Alice's notes (should work)**

```bash
curl http://127.0.0.1:3000/api/notes \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq
```

Output: Alice owns notes 1, 2, 3.

**Step 3: Try to read Bob's note (should fail, but doesn't in vulnerable mode)**

Bob owns note 4. Alice tries to read it:

```bash
curl http://127.0.0.1:3000/api/notes/4 \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq
```

### Expected Result

**Vulnerable mode:** `200 OK`

```json
{
  "note": {
    "id": 4,
    "title": "Private project notes",
    "content": "Ideas for a side project, still early.",
    "userId": 2,
    "createdAt": "2024-01-15T10:10:00.000Z",
    "updatedAt": "2024-01-15T10:10:00.000Z"
  }
}
```

Alice successfully reads Bob's private note. **This is the exploit.**

**Secure mode:** `404 Not Found`

```json
{
  "error": {
    "message": "Note not found",
    "code": "NOT_FOUND"
  }
}
```

The same request returns 404. The note exists but Alice doesn't own it, so it is hidden. Note: we return `404`, not `403`, to avoid an existence oracle (a `403` would confirm the ID exists).

### Security Impact

**High.** An attacker can read any user's notes by iterating through note IDs. If notes contained sensitive data (financial records, private plans, etc.), this would be a complete confidentiality breach.

**Real-world impact:**

- Leaked trade secrets
- Exposed personal information
- Account-takeover through notes containing password hints or recovery info
- Data exfiltration for competitors

### Secure Fix

Use `findFirst` instead of `findUnique`, adding the ownership condition:

```typescript
export async function getNoteByIdSecure({ noteId, userId }: GetNoteParams) {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!note) throw new NotFoundError('Note not found'); // 404, not 403
  return note;
}
```

Why this works:

1. **`findFirst` allows multiple conditions** — `{ id: noteId, userId }` means "find a note where id matches AND userId matches."
2. **Ownership is mandatory** — If the user doesn't own the note, the query returns null.
3. **No existence oracle** — Returning `404` in all "not found" cases hides whether the ID is valid.

The route selector now returns the secure version:

```typescript
export function getNoteById(mode: LabMode) {
  return mode === 'vulnerable' ? getNoteByIdInsecure : getNoteByIdSecure;
}
```

### Secure Code

```typescript
// src/services/notes.service.ts (secure version)
export async function getNoteByIdSecure({ noteId, userId }: GetNoteParams) {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  // 404, not 403: a 403 would confirm the id exists but isn't the caller's,
  // turning the status code itself into an existence oracle.
  if (!note) throw new NotFoundError('Note not found');
  return note;
}
```

### Lesson for Developers

**Authentication is not authorization.** Every resource endpoint must verify ownership:

1. **Get the user ID from the token** — Never from the request body.
2. **Query with ownership as a filter** — Use `{ id, userId }`, not just `{ id }`.
3. **Return the same error for "not found" cases** — Avoid leaking whether the ID exists.

This applies to every resource type: notes, messages, files, settings, etc.

---

## V2 — Mass Assignment / Privilege Escalation

**OWASP API Security:** [API3:2023 — Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0x01-index/)

### Affected Route

`PATCH /api/users/me`

### Root Cause

The endpoint accepts a request body and directly casts it to Prisma's update input type without filtering which fields are allowed:

```typescript
// Vulnerable: any field in the body is accepted
const user = await prisma.user.update({
  where: { id: userId },
  data: body as Prisma.UserUpdateInput,
});
```

The type cast `as Prisma.UserUpdateInput` tells TypeScript "trust me, this is valid." If the ORM object includes `role`, `passwordHash`, or any other sensitive field, those fields are updated directly.

### Why This Happens

In real development:

1. The API has a form that sends `name` and `email`.
2. The developer passes `data: req.body` directly.
3. To satisfy TypeScript, they cast: `data: body as Prisma.UserUpdateInput`.
4. The cast looks like a type chore, not a security boundary.
5. Code reviewers miss it — it's ubiquitous across codebases.

The exploit works because the frontend never renders a `role` field, so developers assume attackers won't send one. **The frontend is not a security boundary.**

### Vulnerable Code

```typescript
// src/services/users.service.ts
export async function updateMeInsecure({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  // The settings form only ever sends name and email.
  const user = await prisma.user.update({
    where: { id: userId },
    data: body as Prisma.UserUpdateInput,
  });
  return toPublicUser(user);
}
```

### Local Reproduction

**Prerequisites:** Lab running in vulnerable mode, Alice seeded.

**Step 1: Get Alice's token**

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

echo "Alice token: $ALICE_TOKEN"
```

**Step 2: Try to escalate to ADMIN**

```bash
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}' | jq
```

### Expected Result

**Vulnerable mode:** `200 OK`

```json
{
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.local",
    "role": "ADMIN",
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

Alice is now an ADMIN. Verify the change persists:

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user.role'
```

Output: `"ADMIN"` — the escalation is permanent.

**Why it persists:** The auth middleware reads the role from the database on every request (not from the token), so the escalation is visible immediately without re-login.

**Secure mode:** `400 Bad Request`

```json
{
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "details": [
      { "path": "role", "message": "Unrecognized key: \"role\"" },
      { "path": "(root)", "message": "At least one of name or email is required" }
    ]
  }
}
```

The `role` key is rejected as unknown. The database is unchanged. Alice's role is still `"USER"`.

### Scope of the bug

`data: body` writes whatever the client sends, so the reachable surface is every
field Prisma will accept on this model — not just `role`. Episode 1 stays on the
role escalation because that is the clearest, most consequential case, but when
you fix this class of bug, fix it as "the client cannot choose which fields get
written", not as "block the `role` key".

### Security Impact

**Critical.** An attacker can escalate their privileges, potentially unlocking admin-only features. In this lab, `role = "ADMIN"` doesn't grant extra power (there are no admin endpoints), but in a real app it would be catastrophic — account takeovers, data modification, deletion, etc.

**Real-world impact:**

- Unauthorized access to admin panels
- Ability to modify other users' data
- Ability to delete records
- Account takeovers
- Regulatory violations (if sensitive data is modified)

### Secure Fix

Use Zod's `strictObject` to validate and whitelist allowed fields, then explicitly map only those fields to the update:

```typescript
// src/schemas/user.schema.ts
export const updateMeSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().toLowerCase().optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'At least one of name or email is required',
  });

// src/services/users.service.ts
export async function updateMeSecure({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  const input = updateMeSchema.parse(body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name, email: input.email }, // Explicit mapping
    select: publicUserSelect,
  });
  return toPublicUser(user);
}
```

Why this works:

1. **`strictObject` rejects unknown keys** — A `{"role":"ADMIN"}` injection fails validation immediately.
2. **Explicit field mapping** — Only `name` and `email` are written, never `role` or `passwordHash`.
3. **Validation error surfaces in logs** — The rejected key shows up as `details[0].path === "role"`, making attacks visible.

### Secure Code

```typescript
// src/schemas/user.schema.ts
export const updateMeSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().toLowerCase().optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'At least one of name or email is required',
  });

// src/services/users.service.ts
export async function updateMeSecure({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  const input = updateMeSchema.parse(body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name, email: input.email },
    select: publicUserSelect,
  });
  return toPublicUser(user);
}
```

### Lesson for Developers

**The frontend is not a security boundary.** Assume the client can send anything:

1. **Never cast request bodies** — `as Prisma.UserUpdateInput` bypasses validation entirely.
2. **Always validate with a schema** — Zod's `strictObject` rejects unknown keys.
3. **Whitelist allowed fields** — Explicitly map schema fields to database fields.
4. **Test with forbidden fields** — Add `{"role":"ADMIN"}` to your test suite and expect `400`.

This pattern applies to every mutation endpoint: create, update, patch, delete.

---

## V3 — Excessive Data Exposure

**OWASP API Security:** [API3:2023 — Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0x01-index/)

### Affected Route

`GET /api/users/me`

### Root Cause

The endpoint returns the entire Prisma ORM object without filtering which fields are included:

```typescript
// Vulnerable: returns the whole row
const user = await prisma.user.findUnique({ where: { id: userId } });
return user; // Contains passwordHash, resetToken, updatedAt, etc.
```

The Prisma `User` type includes every scalar on the model. When the ORM object is serialized to JSON, all fields are included — the developer never explicitly decided which fields to return.

### Why This Happens

In real development:

1. The developer queries the database: `prisma.user.findUnique(...)`
2. They return it directly: `res.json(user)`
3. TypeScript is satisfied — the type is `User`, which looks "correct."
4. Tests pass; the API works.
5. The leak is invisible until DevTools or a proxy reveals it.

Developers rarely ask "What fields should be visible?" — they assume ORM model equals response shape.

### Vulnerable Code

```typescript
// src/services/users.service.ts
export async function getMeInsecure(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');
  return user; // Entire row, including passwordHash, resetToken, updatedAt
}
```

### Local Reproduction

**Prerequisites:** Lab running in vulnerable mode, Alice seeded.

**Step 1: Get Alice's token**

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

echo "Alice token: $ALICE_TOKEN"
```

**Step 2: Fetch Alice's profile**

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq
```

### Expected Result

**Vulnerable mode:** `200 OK`

```json
{
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.local",
    "passwordHash": "$2b$12$r/o4ovHxtE...truncated...",
    "role": "USER",
    "resetToken": "lab-not-a-real-secret-reset-token-alice",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z"
  }
}
```

The response includes:

- **`passwordHash`** — The bcrypt-hashed password. Even though it is hashed, an attacker can perform offline cracking with a GPU rig or wordlist.
- **`resetToken`** — A fictional lab value, but in a real app this is an account-takeover primitive — it allows resetting the password.
- **`updatedAt`** — Metadata that reveals when the account was last modified.

**Secure mode:** `200 OK`

```json
{
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.local",
    "role": "USER",
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

Only the public fields are returned: `id`, `name`, `email`, `role`, `createdAt`. No `passwordHash`, `resetToken`, or `updatedAt`.

### Security Impact

**High.** Leaking `passwordHash` enables offline cracking. A modern GPU can test billions of password guesses per second, and weak passwords (even with bcrypt) can be cracked.

Leaking `resetToken` (or any similar recovery mechanism) is an **account-takeover vector** — an attacker can reset the password without knowing the current one.

Leaking `updatedAt` reveals metadata that can be used in social engineering or to infer when a user last logged in.

**Real-world impact:**

- Compromised passwords through offline cracking
- Account takeovers via leaked reset tokens
- Privacy leaks through metadata
- Compliance violations (GDPR, HIPAA, PCI-DSS, etc.)

### Secure Fix

Use Prisma's `select` option to choose only the fields to return, and explicitly transform the result with a DTO:

```typescript
// src/services/users.service.ts
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

export function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function getMeSecure(userId: number): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect, // Database: only fetch these fields
  });
  if (!user) throw new NotFoundError('User not found');
  return toPublicUser(user); // Boundary: explicitly copy fields
}
```

Why this is **defence in depth**:

1. **`select` at query time** — The database only fetches the whitelisted fields, saving bandwidth and preventing accidental leaks in logs.
2. **`toPublicUser` at response time** — Every field is copied by name. If the `User` model gains a new sensitive field (`twoFactorSecret`, `lastLoginIp`, etc.), the DTO is unchanged — the field is not automatically included.

### Secure Code

```typescript
// src/services/users.service.ts
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

export function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function getMeSecure(userId: number): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
  if (!user) throw new NotFoundError('User not found');
  return toPublicUser(user);
}
```

### Lesson for Developers

**Explicit response shapes are a security decision, not an afterthought.** Never return ORM objects directly:

1. **Define a DTO** — Use only `PublicUser` for user responses.
2. **Use database `select`** — Fetch only the fields you need, blocking sensitive fields at the source.
3. **Explicitly copy fields** — `toPublicUser` ensures model changes don't auto-widen the response.
4. **Test the response shape** — Assert that `Object.keys(response.user).sort()` contains only `['createdAt', 'email', 'id', 'name', 'role']`.

---

## What Is NOT Vulnerable

The lab deliberately implements the following correctly, even in vulnerable mode:

| Component        | Implementation                                                     | Notes                                                                       |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| JWT signing      | HS256, 32-char secret, proper expiry, issuer pinned                | No algorithm confusion or `alg: none`                                       |
| Password hashing | bcrypt (not MD5, plaintext, or weak salts)                         | Cost is configurable for testing                                            |
| Login errors     | Identical for unknown email and wrong password on login            | Registration and PATCH return 409 on duplicate email (documented trade-off) |
| List operations  | Owner-scoped in both modes (`GET /api/notes`)                      | Only the caller's notes returned                                            |
| Update/delete    | Owner-scoped in both modes on the note routes                      | 404 when the note is not yours                                              |
| Error responses  | No stack traces in either mode                                     | Logged to stderr, never in HTTP responses                                   |
| Server binding   | Defaults to `127.0.0.1`; Docker publishes with `127.0.0.1:` prefix | Docker is safe; bare `docker run -p 3000:3000` would expose                 |
| Note creation    | `userId` from token, not from request body                         | Spoofed `userId` is rejected                                                |

---

## Testing the Fixes

Each vulnerability has a corresponding test:

- **`tests/auth.test.ts`** — Proves auth is correct in both modes
- **`tests/vulnerable.test.ts`** — Proves the exploits work in vulnerable mode
- **`tests/secure.test.ts`** — Proves the fixes work in secure mode

Run all tests:

```bash
pnpm test
```

Run in watch mode:

```bash
pnpm test:watch
```

---

## References

- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x01-index/)
- [CWE-639: Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html)
- [CWE-915: Improperly Controlled Modification of Dynamically-Determined Object Attributes](https://cwe.mitre.org/data/definitions/915.html)
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
