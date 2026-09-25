# Spec 001 — Vulnerable Notes API ("Private Notes API")

> **Internal planning document.** Kept for provenance. The shipped behaviour is
> described in [docs/vulnerabilities.md](../vulnerabilities.md); where this spec and
> the code disagree, the code is correct.

Status: APPROVED (planning complete)
Owner: PLANNER (architect-reviewer)
Audience: implementing agents (CODER/TESTER/REVIEWER) and the orchestrator
Companion file: `docs/tasks.md` (execution queue)

---

## 1. Overview & goals

An intentionally vulnerable, **education-only** Node.js + TypeScript REST API used as the
teaching artifact for the YouTube series *"Cybersecurity for Developers"*.

The product is a small multi-user **Private Notes API**: users register, log in, and create
notes that only they should be able to read.

The lab demonstrates exactly **three** vulnerabilities from a *developer's* point of view —
each one a realistic mistake a competent engineer makes under deadline — together with the
secure fix for each:

| # | Vulnerability | Endpoint | OWASP API Top 10 |
|---|---|---|---|
| V1 | Broken Object Level Authorization (IDOR) | `GET /api/notes/:id` | API1:2023 |
| V2 | Mass Assignment / privilege escalation | `PATCH /api/users/me` | API3:2023 (BOPLA) |
| V3 | Excessive Data Exposure | `GET /api/users/me` | API3:2023 (BOPLA) |

Goals:

- G1 — Each vulnerability is visible in **a handful of lines**, readable on camera at 1080p.
- G2 — A single `pnpm test` run proves **both** the vulnerable behaviour and the secure fix.
- G3 — `git diff vulnerable secure -- src/` shows **exactly the three fixes and nothing else**.
- G4 — The code looks like a real product, not a CTF. No planted "hack me" hints, no
  obviously sloppy code, no commented-out `// VULNERABLE HERE` markers in the vulnerable
  code paths themselves (explanatory comments live in `docs/vulnerabilities.md`).
- G5 — Everything except the three vulnerabilities is **correct and secure**: JWT, bcrypt,
  validation, error handling.
- G6 — A viewer can clone, `pnpm i && pnpm db:reset && pnpm dev`, and reproduce every
  exploit with the curl commands in `docs/lab-guide.md` in under five minutes.

## 2. Non-goals

- No frontend, no UI, no HTML. API only (curl / HTTP client).
- No production deployment, no public hosting, no cloud infra, no TLS termination.
- No additional vulnerabilities: **no** SQLi, XSS, SSRF, weak JWT (`alg:none`, hardcoded
  secret), plaintext/MD5 passwords, CORS wildcard-with-credentials, rate-limit removal,
  or prototype pollution. If an implementer notices a fourth weakness, it is a **bug** —
  file it as a task, do not ship it.
- No refresh tokens, password reset flow, email sending, or OAuth. `resetToken` exists on
  the model **only** as a second sensitive field for V3 to leak; it is never populated by a
  live code path (the seed sets a fictional value).
- No multi-tenancy, pagination, search, file upload, or admin endpoints. `role = ADMIN`
  grants nothing in this app — the point of V2 is that the escalation *happens*, not that
  it unlocks a feature. This is stated in `docs/vulnerabilities.md`.
- No Postgres/MySQL. SQLite only.

## 3. Safety & ethics constraints (non-negotiable)

- S1 — The app binds `127.0.0.1` only. `docker-compose.yml` publishes
  `127.0.0.1:3000:3000` (never `3000:3000`), and `src/server.ts` calls
  `app.listen(PORT, '127.0.0.1')`.
- S2 — `README.md` opens with a prominent warning block: educational lab, intentionally
  vulnerable, **never deploy, never expose to a network, never run against data or systems
  you do not own**. `SECURITY.md` states there is no supported version, no security
  contact process for the vulnerabilities (they are the product), and how to report an
  *unintended* vulnerability.
- S3 — No real secrets anywhere. `.env.example` ships an obviously fake
  `JWT_SECRET=dev-only-insecure-secret-change-me-32chars`. `.env` is gitignored. Seed
  passwords are documented lab-only values (`alice@example.local` / `Password123!`,
  `bob@example.local` / `Password123!`) using the reserved `.local` TLD — never real
  addresses or reused passwords.
- S4 — On boot with `LAB_MODE=vulnerable`, the server prints a multi-line banner to stderr:
  intentionally vulnerable mode, localhost only. Impossible to run it unaware.
- S5 — `LAB_MODE` **defaults to `secure`** (fail-closed). Vulnerability must be opted into.
- S6 — If `NODE_ENV=production` and `LAB_MODE=vulnerable`, the process refuses to start
  and exits with a non-zero code.
- S7 — Exploit material stays inside this repo against this repo's own seed data. No
  third-party targets are referenced.

## 4. Tech stack (fixed — do not substitute)

Node.js 20 LTS+ (ESM, `"type": "module"`), TypeScript 5 (strict), Express 5, Prisma +
SQLite, `jsonwebtoken`, Zod, `bcrypt`, Vitest + Supertest, Docker, pnpm. ESLint
(typescript-eslint, flat config) + Prettier. `tsx` for dev, `tsc` for build.

Dependency budget: the list above plus `dotenv`. Any further runtime dependency requires a
note in the task's review and the orchestrator's sign-off.

Relevant platform facts the implementation must rely on:

- **Express 5 automatically forwards rejected promises** from async route handlers and
  middleware to the error-handling middleware. Do **not** add an `asyncHandler` wrapper or
  `express-async-errors`; write plain `async` handlers and `throw`.
- Express 5 uses path-to-regexp v8: wildcard routes must be named (`app.use('/{*path}', …)`
  or a bare `app.use(notFoundHandler)`), not `'*'`.
- **Prisma does not support `enum` on the SQLite provider.** `role` is modelled as
  `String @default("USER")` and typed in TypeScript as `type Role = 'USER' | 'ADMIN'`.
  This is load-bearing: it is also *why* V2 is exploitable with a plain JSON string.

## 5. Domain model

`prisma/schema.prisma` (sketch — exact file produced in T-002):

```prisma
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         String   @default("USER")   // "USER" | "ADMIN" (SQLite has no enums)
  resetToken   String?                     // sensitive; exists to be leaked by V3
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  notes        Note[]
}

model Note {
  id        String   @id @default(uuid())
  title     String
  content   String
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

Seed (`prisma/seed.ts`): Alice and Bob, both `role = "USER"`, both with a fictional
`resetToken` (e.g. `"lab-reset-token-alice-not-a-real-secret"`), plus 3 fictional notes
each. Bob's notes must contain an obviously private-looking (but fictional) string such as
`"Private release notes — production migration scheduled Friday."` so the IDOR demo lands on
camera. Seed is idempotent (`upsert` by email) and re-hashes passwords with the configured
bcrypt cost.

### Public DTO

```ts
export const publicUserSelect = {
  id: true, name: true, email: true, role: true, createdAt: true,
} as const;

export type PublicUser = { id: string; name: string; email: string; role: Role; createdAt: Date };
export function toPublicUser(user: User | PublicUserRow): PublicUser { /* explicit field copy */ }
```

`PublicUser` is the **only** user shape ever returned by register, login, and the secure
`GET/PATCH /api/users/me`. Only `getMeInsecure` returns anything else.

## 6. Route table

Base path `/api`. All bodies JSON. All non-auth routes require
`Authorization: Bearer <jwt>`. Every 4xx/5xx uses the error envelope from §9.

| Method | Path | Auth | Body (Zod) | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | no | `{ name, email, password }` | `201 { user: PublicUser, token: string }` | 400 validation, 409 email taken |
| POST | `/api/auth/login` | no | `{ email, password }` | `200 { user: PublicUser, token: string }` | 400 validation, 401 invalid credentials |
| GET | `/api/users/me` | yes | — | `200 PublicUser` *(secure)* / `200 <raw user row>` *(vulnerable — **V3**)* | 401 |
| PATCH | `/api/users/me` | yes | `{ name?, email? }` strict *(secure)* / anything *(vulnerable — **V2**)* | `200 PublicUser` | 400 validation/unknown key, 401, 409 email taken |
| GET | `/api/notes` | yes | — | `200 { notes: Note[] }` (caller's notes only, `orderBy: createdAt desc`) | 401 |
| POST | `/api/notes` | yes | `{ title, content }` | `201 Note` | 400, 401 |
| GET | `/api/notes/:id` | yes | — | `200 Note` — secure: only if owned, else 404; vulnerable: **any** note (**V1**) | 401, 404 |
| PATCH | `/api/notes/:id` *(optional)* | yes | `{ title?, content? }` strict | `200 Note` | 400, 401, 404 |
| DELETE | `/api/notes/:id` *(optional)* | yes | — | `204` no body | 401, 404 |
| GET | `/health` | no | — | `200 { status: "ok", labMode }` | — |

**Critical rule for the optional routes:** `PATCH`/`DELETE /api/notes/:id` are
ownership-scoped (`findFirst`/`updateMany`/`deleteMany` with `{ id, userId }`, 404 on
miss) in **both** modes. They are not part of the lab; making them IDOR-able would add a
fourth vulnerability and pollute G3. If time is short, cut them entirely (T-006).

### Shapes

```jsonc
// PublicUser
{ "id": "…", "name": "Alice", "email": "alice@example.local", "role": "USER",
  "createdAt": "2026-01-01T00:00:00.000Z" }

// Note
{ "id": "…", "title": "…", "content": "…", "userId": "…",
  "createdAt": "…", "updatedAt": "…" }

// Raw user row returned by V3 (vulnerable mode only)
{ "id": "…", "name": "Alice", "email": "…", "passwordHash": "$2b$…",
  "role": "USER", "resetToken": "lab-reset-token-alice-not-a-real-secret",
  "createdAt": "…", "updatedAt": "…" }
```

Validation rules: `name` 1–80 chars trimmed; `email` `z.string().email()` lowercased;
`password` min 8, max 72 (bcrypt byte limit), max length enforced to avoid long-input hashing;
`title` 1–120; `content` 1–10000. Body size capped via `express.json({ limit: '100kb' })`.

## 7. Auth design (identical and correct in both modes)

- **Hashing** — `bcrypt.hash(password, env.BCRYPT_COST)`; `BCRYPT_COST` defaults to `12`,
  tests set `4` for speed. Login uses `bcrypt.compare`. Login returns the same generic
  `401 { code: "INVALID_CREDENTIALS" }` for unknown email and wrong password (no user
  enumeration). `passwordHash` is never selected into a response.
- **Tokens** — `jsonwebtoken`, HS256, `env.JWT_SECRET` (Zod-validated, min 32 chars),
  `expiresIn` from `env.JWT_EXPIRES_IN` (default `1h`), `issuer: "vulnerable-notes-api"`,
  `subject: user.id`. Verification **pins** `{ algorithms: ['HS256'], issuer }` — this
  closes algorithm-confusion and is called out in the video as "the part we got right".
  Payload carries `sub` only; no PII, no secrets.
- **Middleware** (`src/middleware/auth.ts`) — parse `Authorization: Bearer <token>`
  (missing/malformed → 401 `UNAUTHORIZED`), verify, then **load the user from the database**
  and attach `req.user = { id, role }`. Rationale: role is read fresh per request, so the
  V2 privilege escalation is observable on the *very next* request without re-login — that
  is the on-camera payoff. A deleted user's token yields 401.
- Express `Request` is augmented with `user?: AuthenticatedUser` via `declare global` in
  `src/middleware/auth.ts`. Handlers use a small `requireUser(req)` helper that throws if
  absent, so no non-null assertions (`!`) leak into route code.
- Not in scope: refresh tokens, logout/denylist, rate limiting (documented as a known
  simplification in `docs/architecture.md`, explicitly **not** one of the three vulns).

## 8. `LAB_MODE` switch design

Single env var: `LAB_MODE=vulnerable|secure`, default `secure`.

```
src/config/env.ts      →  Zod-parsed, frozen `env` object; `LabMode` type exported
src/services/*.service.ts
                       →  export BOTH `fooInsecure` and `fooSecure`
                       →  export a selector: `export const getNoteById = (mode: LabMode) =>
                            mode === 'vulnerable' ? getNoteByIdInsecure : getNoteByIdSecure`
src/app.ts             →  `createApp({ labMode = env.LAB_MODE }: CreateAppOptions = {})`
src/routes/*.routes.ts →  factory: `createNotesRouter(labMode)`; the handler calls
                            `await getNoteById(labMode)({ noteId, userId })`
```

Rules:

- Both implementations of a given operation share **one signature and one return contract**
  (apart from the deliberate V3 shape difference). The selector is the only branch point;
  there are **no** `if (labMode === …)` checks inside handlers, services, or middleware
  beyond the three selectors.
- `createApp` takes the mode as an option so a **single Vitest run can mount two apps** —
  `createApp({ labMode: 'vulnerable' })` and `createApp({ labMode: 'secure' })` — against
  the same database. This is what satisfies G2.
- Only these three operations are switched: `getNoteById`, `updateMe`, `getMe`. Everything
  else has exactly one implementation.
- `GET /health` echoes `labMode` so the lab guide can show which mode is live.

## 9. Error-handling design

Envelope (all errors, both modes):

```json
{ "error": { "code": "NOT_FOUND", "message": "Note not found", "details": [] } }
```

- `src/utils/http-error.ts`-style `AppError { status, code, message, details? }` with
  `BadRequestError(400)`, `UnauthorizedError(401)`, `ForbiddenError(403)`,
  `NotFoundError(404)`, `ConflictError(409)`. (File lives alongside the middleware; see §11.)
- `src/middleware/error-handler.ts` maps: `ZodError` → 400 `VALIDATION_ERROR` with
  `error.issues` flattened to `[{ path, message }]`; `AppError` → its own status/code;
  Prisma `P2002` → 409 `CONFLICT`; Prisma `P2025` → 404 `NOT_FOUND`; anything else → 500
  `INTERNAL_ERROR` with the static message `"Internal server error"`.
- **Stack traces are never sent over HTTP in either mode.** They are logged to stderr only.
  Leaking stacks in vulnerable mode would be a *fourth* vulnerability (verbose errors) and
  would break G3/§2. This is a deliberate decision — record it in `docs/architecture.md`.
- Errors thrown inside `async` handlers propagate automatically (Express 5); the error
  handler is registered **last**, after a 404 catch-all that throws `NotFoundError`.
- The handler must keep the 4-argument signature `(err, req, res, next)` or Express will
  not recognise it.

## 10. Per-vulnerability design

Each subsection gives the vulnerable sketch, the secure sketch, and why it is realistic.
The sketches are normative for shape; implementers may adjust naming details.

### V1 — Broken Object Level Authorization (IDOR), `GET /api/notes/:id`

```ts
// src/services/notes.service.ts — VULNERABLE
export async function getNoteByIdInsecure({ noteId }: GetNoteParams): Promise<Note> {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) throw new NotFoundError('Note not found');
  return note;
}
```

```ts
// src/services/notes.service.ts — SECURE
export async function getNoteByIdSecure({ noteId, userId }: GetNoteParams): Promise<Note> {
  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!note) throw new NotFoundError('Note not found');   // 404, not 403: no existence oracle
  return note;
}
```

Why it is realistic: the route is behind `requireAuth`, so the endpoint *feels* protected —
the developer conflates **authentication** ("who are you") with **authorization** ("is this
yours"). `findUnique` is the natural Prisma call for a by-id lookup and cannot express the
ownership filter (it only accepts unique fields), so the fix also changes the method to
`findFirst` — a genuinely non-obvious step. `GetNoteParams` is `{ noteId, userId }` in both
versions; the insecure one simply never destructures `userId`, so there is no unused-variable
smell and no `_` prefix telegraphing the bug.

Camera note: the diff is two lines. Return **404** (not 403) in the secure version so an
attacker cannot use the status code to enumerate valid note ids — mention this on camera.

### V2 — Mass assignment / privilege escalation, `PATCH /api/users/me`

```ts
// src/services/users.service.ts — VULNERABLE
export async function updateMeInsecure({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  // the settings form only sends name and email
  const user = await prisma.user.update({
    where: { id: userId },
    data: body as Prisma.UserUpdateInput,
  });
  return toPublicUser(user);
}
```

```ts
// src/schemas/user.schema.ts — SECURE
export const updateMeSchema = z
  .strictObject({                       // unknown keys are rejected, not stripped
    name: z.string().trim().min(1).max(80).optional(),
    email: z.string().email().toLowerCase().optional(),
  })
  .refine((v) => v.name !== undefined || v.email !== undefined, {
    message: 'At least one of name or email is required',
  });

// src/services/users.service.ts — SECURE
export async function updateMeSecure({ userId, body }: UpdateMeParams): Promise<PublicUser> {
  const input = updateMeSchema.parse(body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name, email: input.email },   // explicit mapping, never a spread
    select: publicUserSelect,
  });
  return toPublicUser(user);
}
```

Why it is realistic: `data: req.body` is the shortest path from "the form sends the fields"
to "the row is updated", and it type-checks the moment someone adds `as Prisma.UserUpdateInput`
to silence the compiler — a cast that looks like a chore, not a security decision. The
schema exists elsewhere in the codebase, so the reviewer's eye slides over its absence here.

Three defences are shown, in order of strength: (1) `strictObject` rejects unknown keys with
400 rather than silently stripping them, which surfaces attacks in logs; (2) explicit field
mapping means a future schema change cannot widen the write surface; (3) `select:
publicUserSelect` keeps the response clean. Note `data: { name: undefined }` is a no-op in
Prisma, so partial updates work without extra branching.

Expected behaviours — vulnerable: `PATCH {"role":"ADMIN"}` → `200` and the row's role is now
`ADMIN`; the next `GET /api/users/me` confirms it (middleware reads role from the DB).
Secure: same request → `400 VALIDATION_ERROR` with `details[0].path === "role"`, and the role
is unchanged.

### V3 — Excessive data exposure, `GET /api/users/me`

```ts
// src/services/users.service.ts — VULNERABLE
export async function getMeInsecure(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');
  return user;                       // whole row: passwordHash, resetToken, updatedAt
}
```

```ts
// src/services/users.service.ts — SECURE
export async function getMeSecure(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
  if (!user) throw new NotFoundError('User not found');
  return toPublicUser(user);
}
```

Why it is realistic: `res.json(user)` with the ORM object is the default ergonomic path;
Prisma returns every scalar unless you ask otherwise, and TypeScript is perfectly happy —
the type is `User`, which is "correct". Nothing fails, no test breaks, and the leak is
invisible until someone opens DevTools. The lesson: the response shape must be an explicit
decision (`select` + DTO), not a side effect of the query. Emphasise defence in depth —
`select` stops it at the database, `toPublicUser` stops it at the boundary.

Camera note: pair this with V2 — a leaked `passwordHash` plus an offline cracking rig is
why "it's hashed" is not a defence, and the leaked `resetToken` is a live account-takeover
primitive in a real app.

## 11. Repo layout

```
.
├─ README.md                    # warning block first, then quickstart
├─ SECURITY.md
├─ .env.example                 # no real secrets
├─ .gitignore  .dockerignore  .editorconfig
├─ eslint.config.js  .prettierrc  .prettierignore
├─ tsconfig.json  package.json  pnpm-lock.yaml  vitest.config.ts
├─ Dockerfile                   # multi-stage, non-root user
├─ docker-compose.yml           # 127.0.0.1:3000:3000 only
├─ docs/
│  ├─ architecture.md           # layers, LAB_MODE, decisions & simplifications
│  ├─ vulnerabilities.md        # the three: cause, exploit, fix, OWASP ref
│  ├─ lab-guide.md              # copy-paste curl walkthrough, per episode
│  ├─ tasks.md
│  └─ specs/001-vulnerable-notes-api.md
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.ts
│  └─ migrations/
├─ src/
│  ├─ server.ts                 # listen on 127.0.0.1, banner, graceful shutdown
│  ├─ app.ts                    # createApp({ labMode }) → Express app
│  ├─ config/env.ts             # Zod-parsed env, LabMode
│  ├─ lib/prisma.ts             # PrismaClient singleton
│  ├─ middleware/
│  │  ├─ auth.ts                # requireAuth, Request augmentation, requireUser
│  │  ├─ error-handler.ts       # errorHandler + notFoundHandler + AppError classes
│  ├─ routes/{auth,users,notes}.routes.ts
│  ├─ schemas/{auth,user,note}.schema.ts
│  ├─ services/{auth,users,notes}.service.ts
│  └─ utils/jwt.ts              # signToken, verifyToken
└─ tests/
   ├─ helpers/{app,db,auth}.ts  # app factories, truncate, register+login
   ├─ auth.test.ts
   ├─ vulnerable.test.ts
   └─ secure.test.ts
```

`AppError` and its subclasses live in `src/middleware/error-handler.ts` (exported) to keep
the file count at the agreed layout; if that file exceeds ~120 lines, split to
`src/utils/errors.ts` and note it in the task.

Env vars (`.env.example`): `NODE_ENV`, `PORT=3000`, `HOST=127.0.0.1`,
`DATABASE_URL="file:./dev.db"`, `JWT_SECRET` (≥32 chars, fake), `JWT_EXPIRES_IN=1h`,
`BCRYPT_COST=12`, `LAB_MODE=secure`.

npm scripts: `dev`, `build`, `start`, `test`, `test:watch`, `lint`, `format`,
`typecheck`, `db:push`, `db:migrate`, `db:seed`, `db:reset`.

## 12. Test strategy

Runner: Vitest + Supertest against `createApp(...)` — **no network listener** in tests.
Database: a dedicated SQLite file (`DATABASE_URL="file:./prisma/test.db"`), schema applied
once in `globalSetup` via `prisma db push --force-reset`. Vitest is configured
single-threaded (`poolOptions.forks.singleFork = true`) because SQLite tolerates one
writer. Each test file resets rows in `beforeEach` (`note.deleteMany` then
`user.deleteMany`) and creates its own Alice/Bob via helpers. `BCRYPT_COST=4` in the test
env. Tests never depend on `prisma/seed.ts`.

Assertion → lesson mapping:

**`tests/auth.test.ts`** — runs the same suite against both apps (`describe.each(['vulnerable','secure'])`)
to prove auth is *not* where the bugs are:
- A1 register → 201, body has `token`, `user` has exactly `[id,name,email,role,createdAt]`,
  **no** `passwordHash`/`resetToken` (guards against V3 leaking into auth responses).
- A2 stored `passwordHash` matches `/^\$2[aby]\$/` and `!== plaintext`; `bcrypt.compare` passes.
- A3 duplicate email → 409; invalid body → 400 with `VALIDATION_ERROR`.
- A4 login wrong password → 401, and unknown email → 401 with the **identical** body
  (no user enumeration).
- A5 protected route without header / malformed header / garbage token / token signed with
  a different secret / token with `alg: none` → all 401. New user's `role` is `"USER"`.
- A6 valid token → 200, and `GET /api/notes` returns only the caller's notes in both modes.

**`tests/vulnerable.test.ts`** — app built with `labMode: 'vulnerable'`; every test is
titled as the lesson it proves and asserts the exploit **succeeds**:
- V1 Alice `GET /api/notes/<bobNoteId>` → **200**, and `body.content` equals Bob's private
  content. (Proves IDOR: authentication without authorization.)
- V2 Alice `PATCH /api/users/me {"role":"ADMIN"}` → **200**; subsequent `GET /api/users/me`
  reports `role === "ADMIN"` **and** a direct DB read confirms the row changed.
  Secondary: `{"name":"Alice2","role":"ADMIN"}` also escalates (the legit field is a decoy).
- V3 Alice `GET /api/users/me` → 200 and body has `passwordHash` **and** `resetToken` keys,
  with `body.passwordHash` matching the stored hash. (Proves the ORM row is not a DTO.)
- Negative controls, so the lab is provably scoped to three bugs: `GET /api/notes` still
  returns only Alice's notes; `DELETE /api/notes/<bobNoteId>` → 404 and Bob's note survives;
  no response body anywhere contains the word `"stack"` or a file path.

**`tests/secure.test.ts`** — identical requests, `labMode: 'secure'`, asserting the fix:
- S1 Alice `GET /api/notes/<bobNoteId>` → **404**, body contains none of Bob's content;
  Alice `GET /api/notes/<aliceNoteId>` → **200** (fix does not break the happy path).
- S2 `PATCH {"role":"ADMIN"}` → **400** `VALIDATION_ERROR` with an issue whose `path`
  mentions `role`; DB role still `"USER"`. `PATCH {"name":"Alice2"}` → 200, name updated,
  role untouched, response is a `PublicUser`. `PATCH {}` → 400.
- S3 `GET /api/users/me` → 200 and `Object.keys(body).sort()` **deep-equals**
  `['createdAt','email','id','name','role']` — an exact-key assertion, so adding a field
  later fails the test loudly.
- S4 Unhandled-error path returns the generic 500 envelope with no `stack` property.

Definition of done for the suite: `pnpm test` green with all three files in one run;
`pnpm typecheck` and `pnpm lint` clean.

## 13. Branch strategy

- **`main`** — the complete lab: both implementations, the `LAB_MODE` selector, all three
  test files, full docs. This is what the README tells viewers to clone.
- **`vulnerable`** — cut from `main`, stripped to the insecure path only.
- **`secure`** — cut from `main`, stripped to the secure path only.

Stripping rules (identical on both branches, so the diff is minimal):

1. Delete the `*Secure` / `*Insecure` twin and **rename the survivor to the neutral name**
   (`getNoteByIdInsecure` → `getNoteById`, etc.).
2. Delete the selector functions; routes call the service directly.
3. Delete `labMode` from `createApp` options, the route factories, and `/health`; delete
   `LAB_MODE` from `env.ts` and `.env.example`; delete the S4 startup banner on `secure`,
   keep it on `vulnerable`.
4. Keep `tests/auth.test.ts` (de-parameterised to a single app). Keep only the matching
   vulnerability test file, renamed `tests/vulnerability.test.ts` on both branches so the
   filename does not appear in the diff.
5. Change nothing else — not imports order, not formatting, not comments outside the three
   functions. Run `pnpm format` on `main` **before** cutting so both branches inherit the
   same formatting.

Acceptance: `git diff vulnerable secure -- src/` touches only
`src/services/notes.service.ts`, `src/services/users.service.ts`, and
`src/schemas/user.schema.ts`, and is under ~40 changed lines total. The procedure is
documented step-by-step in `docs/lab-guide.md` so it can be re-run after any change to
`main`; branches are regenerated (force-updated), never hand-edited.

## 14. Open questions — resolved

Both were resolved by the orchestrator during the unattended build and are recorded here
so the spec closes. Either can be revisited; neither is load-bearing.

- **OQ-1 — Keep or cut the optional `PATCH`/`DELETE /api/notes/:id`?**
  **Resolved: kept**, ownership-scoped in both modes (see §6). They earn their place as
  negative controls: the test suite and the reviewer's sweep both use them to demonstrate
  that the lab ships three bugs rather than five. Cutting them would weaken that proof.
- **OQ-2 — Should the demo branches carry their own README variant?**
  **Resolved: no.** One README on `main`; each demo branch adds a single banner line under
  the title naming the branch and pointing at the other two. This keeps
  `git diff vulnerable secure` focused on the security fixes.

Both resolutions are implemented and verified. The reviewer agreed with each in the
round-two review.
