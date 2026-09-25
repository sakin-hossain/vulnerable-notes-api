# Architecture

## System Layers

The lab follows a classic three-layer REST API architecture:

```
┌──────────────────────────────────────────────────────────────┐
│  HTTP Request (Routes)                                       │
│  src/routes/*.routes.ts                                      │
│  - Parse request params / body                               │
│  - Call service functions                                    │
│  - Return HTTP response                                      │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│  Business Logic (Services)                                   │
│  src/services/*.service.ts                                   │
│  - Validate inputs                                           │
│  - Perform authorization checks                              │
│  - Orchestrate database queries                              │
│  - Transform results to DTOs                                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│  Data Access (Prisma ORM)                                    │
│  Prisma.note.findUnique(), prisma.user.update(), etc.        │
│  - Query SQLite database                                     │
│  - Return strongly-typed results                             │
└──────────────────────────────────────────────────────────────┘
```

**Key principle:** Authorization decisions live in the **services layer**, never in the routes or middleware. This ensures business logic is testable and non-negotiable.

---

## Request Lifecycle

### Authenticated request flow

```
1. Client sends: GET /api/notes/1
                 Authorization: Bearer <JWT>

2. Express middleware stack:
   a) JSON body parser (all requests)
   b) requireAuth middleware (checks JWT, loads user from DB)
   c) Route handler

3. Route handler:
   a) Calls requireUser(req) to get {id, email, role}
   b) Parses route params with Zod schema
   c) Calls service function: getNoteById(labMode)({ noteId, userId })

4. Service layer (SWITCHED by labMode):

   VULNERABLE:
   const note = await prisma.note.findUnique({ where: { id: noteId } })
   → Returns note even if userId doesn't match

   SECURE:
   const note = await prisma.note.findFirst({ where: { id: noteId, userId } })
   → Returns 404 if ownership doesn't match

5. Response:
   - Success: 200 { note: {...} }
   - Not found: 404 { error: { code: "NOT_FOUND", ... } }
   - Other errors: caught by global error handler

6. Express error-handling middleware:
   a) Format error into standard envelope
   b) Log stack trace to stderr (never to client)
   c) Send 4xx/5xx response
```

---

## The LAB_MODE Selector Pattern

The dual-implementation approach uses three **selector functions** — one per switched operation. This keeps `labMode` branching out of the service logic.

### How it works

```typescript
// src/services/notes.service.ts

// Two implementations with identical signatures
export async function getNoteByIdInsecure({ noteId }: GetNoteParams) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) throw new NotFoundError('Note not found');
  return note;
}

export async function getNoteByIdSecure({ noteId, userId }: GetNoteParams) {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!note) throw new NotFoundError('Note not found');
  return note;
}

// Selector: the ONLY place labMode is read for this operation
export function getNoteById(mode: LabMode) {
  return mode === 'vulnerable' ? getNoteByIdInsecure : getNoteByIdSecure;
}
```

The insecure version returns any note by ID (V1); the secure version adds `userId` to the query, ensuring ownership.

### Usage in routes

```typescript
// src/routes/notes.routes.ts

export function createNotesRouter(labMode: LabMode): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const { id: userId } = requireUser(req);
    const { id: noteId } = noteIdParamSchema.parse(req.params);

    // Selector is called here; no `if (labMode ...)` in the handler
    const note = await getNoteById(labMode)({ noteId, userId });
    res.status(200).json({ note });
  });

  return router;
}
```

### Three switched operations

Only these three operations have dual implementations:

1. **`getNoteById`** — V1 (IDOR)
2. **`getMe`** — V3 (excessive data exposure)
3. **`updateMe`** — V2 (mass assignment)

Every other operation has **one implementation only**, used in both modes.

### Factory pattern for testing

`createApp` mounts both implementations side by side for testing:

```typescript
// tests/vulnerable.test.ts
const vulnerableApp = createApp({ labMode: 'vulnerable' });
const response = await request(vulnerableApp).get('/api/notes/4');
// Expects 200: Alice can read Bob's note

// tests/secure.test.ts
const secureApp = createApp({ labMode: 'secure' });
const response = await request(secureApp).get('/api/notes/4');
// Expects 404: Alice cannot read Bob's note
```

This allows a **single `pnpm test` run** to prove both the exploit and the fix.

---

## Authentication Design

Authentication is **correct and identical in both modes**. It is not where the vulnerabilities live.

### Token issuance

```typescript
// src/utils/jwt.ts

const ISSUER = 'vulnerable-notes-api';

export function signAccessToken(user: { id: number }): string {
  const options = {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: ISSUER,
  } as jwt.SignOptions;

  return jwt.sign({ sub: user.id }, env.JWT_SECRET, options);
}
```

Key details:

- **HS256 only** — No algorithm negotiation, no `alg: none`
- **Secret ≥32 characters** — Enforced in env.ts via Zod
- **Expiry from env** — Default `1h`, configurable
- **Issuer pinned** — `vulnerable-notes-api` for scoping
- **No PII in payload** — the token carries `sub` and nothing else. Name, email and
  role are read from the database on each request, so they never sit in a value the
  client can decode, and a stale role cannot linger inside an unexpired token.

### Token verification

```typescript
export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
  });

  if (typeof decoded !== 'object' || decoded === null || typeof decoded.sub !== 'number') {
    throw new Error('Malformed token payload');
  }

  return { sub: decoded.sub };
}
```

Verification is strict:

- **Algorithm must be HS256** — Closes algorithm-confusion attacks
- **Issuer must match** — Prevents cross-app token reuse
- **Secret must be correct** — Tampering detected and rejected
- **Expiry must be valid** — Expired tokens are rejected

### Middleware: `requireAuth`

```typescript
// src/middleware/auth.ts

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new UnauthorizedError('Missing or malformed Authorization header'));
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    next(new UnauthorizedError('Missing bearer token'));
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      next(new UnauthorizedError('User no longer exists'));
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
```

Why role is read from the database:

- **Intent tracking** — If a user's role changes, it takes effect immediately
- **V2 visibility** — The escalation exploit becomes visible on the very next API call (without re-login), which is the on-camera payoff
- **Correct design** — Roles should not be cached in a token; they should be checked fresh

---

## Error-Handling Design

All errors follow a consistent envelope format:

```json
{
  "error": {
    "message": "Note not found",
    "code": "NOT_FOUND"
  }
}
```

### Error mapping

| Error Type              | HTTP Status | Code                | Source                                             |
| ----------------------- | ----------- | ------------------- | -------------------------------------------------- |
| `ZodError` (validation) | 400         | `VALIDATION_ERROR`  | Input parsing                                      |
| `BadRequestError`       | 400         | `BAD_REQUEST`       | Explicit throw                                     |
| `UnauthorizedError`     | 401         | `UNAUTHORIZED`      | Auth failures, missing tokens                      |
| `ForbiddenError`        | 403         | `FORBIDDEN`         | Permission denied (unused in lab)                  |
| `NotFoundError`         | 404         | `NOT_FOUND`         | Resource not found                                 |
| `ConflictError`         | 409         | `CONFLICT`          | Unique constraint violated (e.g., duplicate email) |
| Prisma validation error | 400         | `BAD_REQUEST`       | Malformed body reached the ORM                     |
| Prisma `P2002`          | 409         | `CONFLICT`          | Unique key constraint                              |
| Prisma `P2025`          | 404         | `NOT_FOUND`         | Related record not found                           |
| Malformed JSON body     | 400         | `INVALID_JSON`      | `body-parser` (`entity.parse.failed`)              |
| Body over 100 kB        | 413         | `PAYLOAD_TOO_LARGE` | `body-parser` (`entity.too.large`)                 |
| Unhandled error         | 500         | `INTERNAL_ERROR`    | Any other error                                    |

### Details array

For validation errors, `details` is populated with individual issues:

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

This is especially important for **V2**: a `{"role":"ADMIN"}` injection shows up as `details[0].path === "role"`, making the attack visible in logs.

### Stack traces logged, never sent

```typescript
// src/middleware/error-handler.ts

type ErrorDetail = { path: string; message: string };

function respond(
  res: Response,
  statusCode: number,
  body: { message: string; code?: string; details?: ErrorDetail[] },
  originalError: unknown,
): void {
  if (statusCode >= 500) {
    console.error(originalError);
  }
  res.status(statusCode).json({ error: { ...body } } satisfies ErrorEnvelope);
}
```

Stack traces go to stderr (operator's terminal), never to the HTTP response.

---

## Data Model

### User

```prisma
model User {
  id           Int      @id @default(autoincrement())
  name         String
  email        String   @unique
  passwordHash String
  role         String   @default("USER")    // "USER" | "ADMIN"
  resetToken   String?                      // Sensitive; V3 leaks it
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  notes        Note[]   // One-to-many relation
}
```

Notes:

- **ID is autoincrement** — Allows clear "change 1 to 4" demos for IDOR
- **Email is unique** — Required for login
- **passwordHash is never selected** — Except in V3 (the leak)
- **role is String, not enum** — SQLite has no native enums
- **resetToken is nullable** — Seeded with a fictional value; never used by the application
- **updatedAt is auto-managed** — Prisma's `@updatedAt` directive

### Note

```prisma
model Note {
  id        Int      @id @default(autoincrement())
  title     String
  content   String
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])  // Speeds up "find notes by user"
}
```

Notes:

- **ID is autoincrement** — Same reason as User
- **Ownership via userId** — The fix for V1 adds `userId` to the query condition
- **Cascade delete** — Deleting a user deletes their notes
- **Index on userId** — Optimization for common queries

### Public DTO

All responses use the `PublicUser` shape:

```typescript
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
```

Why explicit field mapping:

- **`select` at query time** — Stops the ORM from fetching unnecessary fields
- **`toPublicUser` at response time** — If the model changes later, the DTO remains safe (defence in depth)
- **Type-safe** — Changes to the User model that weren't reflected in the DTO will type-error

---

## Decisions and Simplifications

### Stack traces logged to stderr only

Stack traces are logged to stderr (visible to operators) but never returned over HTTP, even in vulnerable mode.

### No rate limiting

The lab has no rate limiting or request throttling. Real applications need this; the lab keeps it simple.

### No refresh tokens

Token refresh is out of scope. Tokens expire after the configured time (default `1h`); re-login to get a new one.

### No password reset flow

The `resetToken` field exists **only** as a second sensitive field for **V3** to leak (alongside `passwordHash`). It is never populated by a live code path — the seed sets a fictional value.

### SQLite has no native enums

The `role` field is modeled as `String @default("USER")` in Prisma. TypeScript enforces the union type `'USER' | 'ADMIN'` via explicit type annotations. This is a schema simplification forced by SQLite's lack of native enum support.

**V2 exists entirely because of the unchecked cast** (`data: body as Prisma.UserUpdateInput`), not because of the string type. Even if `role` were a proper Prisma enum, `"ADMIN"` would still be a valid member, and the cast would still allow the injection. The type safety provided by a Prisma enum would not defend against mass assignment without an allowlist.

### Autoincrement IDs, not UUIDs

Integer IDs allow the IDOR demo to show "change ID from 1 to 4" on camera — clearer for teaching than UUIDs.

### Role read from database on every request

The middleware calls `prisma.user.findUnique(...)` to fetch the current role on every request. This differs from production JWT patterns (which cache the role in the token) but suits this lab because:

1. It makes V2 (privilege escalation) immediately visible — Alice can escalate to ADMIN and **without re-login** her very next API call sees the new role.
2. It is clearer for teaching — the camera can show "escalate → get next request → role changed" in one demo.

---

## Implementation Notes

### Express 5 async error forwarding

Express 5 automatically forwards rejected promises from `async` handlers to the error middleware. The lab **does not** use an `asyncHandler` wrapper or `express-async-errors`.

```typescript
router.get('/:id', async (req, res) => {
  // If this throws, Express 5 forwards it to errorHandler automatically
  const note = await getNoteById(labMode)({ noteId, userId });
  res.status(200).json({ note });
});
```

### Prisma string coercion for params

Route params are always strings. The lab uses Zod to coerce and validate them:

```typescript
const noteIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const { id: noteId } = noteIdParamSchema.parse(req.params);
```

The `.int().positive()` guards reject negative IDs, decimals, and invalid formats with a clean 400 error before the request reaches Prisma.

### Validation with `strictObject`

The secure implementation of `updateMe` uses `z.strictObject`, which **rejects** unknown keys:

```typescript
const updateMeSchema = z.strictObject({
  name: z.string().optional(),
  email: z.string().optional(),
});

// { "name": "Alice", "role": "ADMIN" } → 400 VALIDATION_ERROR
// The rejection surfaces in logs, making the attack visible
```

This is what makes V2 fixable: the vulnerable version casts the body as-is; the secure version validates and rejects the injection.

---

## Related Documents

- [Vulnerabilities](vulnerabilities.md) — Deep dive into each of the three bugs
- [Lab Guide](lab-guide.md) — Step-by-step walkthrough with curl commands
- [../README.md](../README.md) — Overview and quick start
