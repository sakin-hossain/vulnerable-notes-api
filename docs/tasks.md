# Task queue — Vulnerable Notes API

> **Internal build log.** This is the task queue the project was built from, kept for
> provenance. It is not part of the lab material — start at [the README](../README.md)
> or [docs/vulnerabilities.md](vulnerabilities.md).
> Spec: `docs/specs/001-vulnerable-notes-api.md` (read it before starting any task).
> Repo root: the repository root.

**Statuses:** `PLANNED` → `IN_PROGRESS` → `IN_REVIEW` → `DONE` (or `BLOCKED`).

**How to update (orchestrator):** each task has exactly one line matching
`**Status:** <VALUE>` directly under its heading. Update in place, e.g.
`sed -i '' '/^### T-004 /,/^\*\*Status:\*\*/ s/^\*\*Status:\*\* PLANNED$/**Status:** IN_PROGRESS/'`.
Append a `**Notes:**` line under a task for blockers or review findings. Do not renumber tasks.

**Rules:** one task per coder run; small diffs; TESTER then REVIEWER on every task
(T-001 excluded from TESTER only — it has no behaviour to test, still needs REVIEWER).
Every task must leave `pnpm typecheck` and `pnpm lint` clean.

---

### T-001 — Project scaffold & tooling

**Status:** DONE
**Notes:** Done by the orchestrator. Deviation from the spec, accepted: the project is **CommonJS**, not ESM (`"type"` omitted, `module: CommonJS`, `moduleResolution: Node`). Rationale: avoids ESM/`NodeNext` extension friction across tsx + Vitest + Prisma for an unattended build, and keeps on-camera imports plain. `verbatimModuleSyntax` is therefore not set. Vitest uses `fileParallelism: false` + `sequence.concurrent: false` instead of `poolOptions.forks.singleFork`. `db:migrate` is not yet a script (T-002 adds migrations). `.editorconfig` not written. Pinned: TS 5.9.3, Express 5.2.1, Zod 4.6.5, Prisma 6.19.3, Vitest 3.2.7, bcrypt 6.0.0, jsonwebtoken 9.0.3, ESLint 9.39.5.
**Depends on:** —
**Scope:** pnpm project, TypeScript (strict, ESM, `NodeNext`), ESLint flat config +
Prettier, Vitest config, `.gitignore`/`.dockerignore`/`.editorconfig`, npm scripts, and
`.env.example`. Install only the dependencies listed in spec §4. No application code.
**Acceptance criteria:**

- [ ] `package.json` has `"type": "module"` and scripts: `dev`, `build`, `start`, `test`,
      `test:watch`, `lint`, `format`, `typecheck`, `db:push`, `db:migrate`, `db:seed`, `db:reset`.
- [ ] `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
      `verbatimModuleSyntax`, `outDir: dist`, includes `src` and `tests`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format` all run and exit 0 on the empty project.
- [ ] `vitest.config.ts` sets `environment: 'node'`, `globalSetup`, and
      `poolOptions.forks.singleFork = true`.
- [ ] `.env.example` lists every var from spec §11 with fake, obviously-not-real values;
      `.env` and `*.db` are gitignored.
- [ ] No runtime dependency outside spec §4.
      **Files:** `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`,
      `.prettierignore`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.editorconfig`,
      `.env.example`

---

### T-002 — Prisma schema, migration & seed

**Status:** DONE
**Notes:** Schema + seed implemented and verified. Deviation, accepted by the orchestrator: ids are `Int @default(autoincrement())`, not `String @default(uuid())`, so the lab guide can say "change the id from 1 to 4" on camera. Seed is idempotent via delete-all + `sqlite_sequence` reset (not upsert), which is what makes ids deterministic: Alice owns notes 1-3, Bob owns 4-6. No `prisma/migrations/` yet — the lab uses `prisma db push`; add migrations only if the human wants them. Seed honours `BCRYPT_COST`; reset tokens contain `not-a-real-secret`.
**Depends on:** T-001
**Scope:** `User` and `Note` models per spec §5 (SQLite, `role` as `String` — **no enum**),
initial migration, and an idempotent seed with Alice, Bob, and three fictional notes each.
**Acceptance criteria:**

- [ ] Schema matches spec §5 including `@@index([userId])` and `onDelete: Cascade`.
- [ ] `role String @default("USER")`; a `Role` TS union type is exported for app use.
- [ ] `pnpm db:migrate` creates `prisma/migrations/` and a working `dev.db`.
- [ ] `pnpm db:seed` is idempotent (upsert by email) and safe to run twice.
- [ ] Seed users `alice@example.local` / `bob@example.local`, password `Password123!`,
      hashed with bcrypt at the configured cost; passwords documented in the seed's header
      comment as lab-only.
- [ ] Each user has a fictional `resetToken` string containing `not-a-real-secret`.
- [ ] One of Bob's notes contains an obviously private-looking but clearly fictional line
      (for the IDOR demo).
- [ ] No real names, emails, or credentials anywhere.
      **Files:** `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/**`, `package.json`

---

### T-003 — Env config, Prisma client, error handling, app & server bootstrap

**Status:** DONE
**Notes:** `app.ts` (createApp factory, /health echoing labMode, notFoundHandler then errorHandler last) and `server.ts` (loopback listen, stderr warning banner in vulnerable mode, SIGINT/SIGTERM graceful shutdown) are done. Error handler additionally maps Zod `unrecognized_keys` issues to one detail per rejected key, so a blocked `{"role":"ADMIN"}` returns `details[0].path === "role"` — this is what T-012 S2 asserts and what the camera shows.
**Notes:** env.ts, lib/prisma.ts and middleware/error-handler.ts are done. `app.ts` and `server.ts` remain (in flight). Orchestrator corrected the first coder pass to match the spec: `JWT_SECRET` min 32, `BCRYPT_COST` added, `LAB_MODE` defaults to `secure`, NODE_ENV=production + vulnerable refuses to boot, the `asyncHandler` wrapper was deleted (Express 5 forwards rejections), Prisma P2025 maps to 404, and the stack-trace-in-response branch was removed so no stack is ever sent over HTTP in either mode.
**Depends on:** T-002
**Scope:** Zod-validated env loader, `PrismaClient` singleton, `AppError` family +
`errorHandler` + `notFoundHandler`, `createApp({ labMode })` with JSON body limit and
`/health`, and `server.ts` binding `127.0.0.1` with the vulnerable-mode banner.
**Acceptance criteria:**

- [ ] `env.ts` validates and exports a frozen object; `JWT_SECRET` min 32 chars;
      `LAB_MODE` defaults to `secure`; `BCRYPT_COST` coerced to int, default 12.
- [ ] Invalid env exits with a readable message and a non-zero code (no stack dump).
- [ ] `NODE_ENV=production` + `LAB_MODE=vulnerable` refuses to start (spec S6).
- [ ] `server.ts` calls `app.listen(PORT, '127.0.0.1')`; prints the S4 warning banner to
      stderr when `LAB_MODE=vulnerable`; handles SIGINT/SIGTERM with a clean shutdown.
- [ ] `createApp` accepts `{ labMode }` and defaults to `env.LAB_MODE`; `express.json({ limit: '100kb' })`.
- [ ] `GET /health` → `200 { status: 'ok', labMode }`.
- [ ] Error handler produces the spec §9 envelope for `ZodError`, `AppError`, Prisma
      `P2002`/`P2025`, and unknown errors; **never** includes a stack or file path in the
      response; logs the stack to stderr. 4-arg signature preserved.
- [ ] Unknown route → 404 `NOT_FOUND` in the standard envelope.
- [ ] No `asyncHandler` wrapper and no `express-async-errors` (Express 5 handles it).
      **Files:** `src/config/env.ts`, `src/lib/prisma.ts`, `src/middleware/error-handler.ts`,
      `src/app.ts`, `src/server.ts`

---

### T-004 — JWT utilities & auth middleware

**Status:** DONE
**Notes:** Reopened and fixed after the tester found T-004 acceptance criteria unmet: the token payload was `{ sub, email, role }` and verification pinned only the algorithm. Now the payload is `{ sub }` alone (no PII, no stale role in an unexpired token) and both `algorithms: [HS256]` and `issuer: vulnerable-notes-api` are pinned on verify. `requireAdmin` is kept but documented in-code as intentionally unmounted — this lab has no admin-only route, so ADMIN grants no capability.
**Notes:** jwt.ts + middleware/auth.ts done. `requireAuth` re-reads id/email/role from the database each request, so the V2 escalation shows up on the very next call without re-login. `requireUser(req)` helper avoids `!` assertions; `requireAdmin` exists for the privilege-escalation payoff. No LAB_MODE branching in either file.
**Depends on:** T-003
**Scope:** `signToken`/`verifyToken` and `requireAuth`. Correct and identical in both
lab modes — this is the "what we got right" material.
**Acceptance criteria:**

- [ ] HS256, secret from env, `expiresIn` from env, `issuer: 'vulnerable-notes-api'`,
      `subject: user.id`; payload carries no PII and no secrets.
- [ ] `verifyToken` pins `{ algorithms: ['HS256'], issuer }`.
- [ ] `requireAuth` rejects missing/malformed `Authorization`, bad signature, expired, and
      `alg: none` tokens with 401 `UNAUTHORIZED` and no detail leakage.
- [ ] Middleware loads the user **from the database** and sets `req.user = { id, role }`;
      unknown/deleted subject → 401.
- [ ] Express `Request` augmented via `declare global`; a `requireUser(req)` helper removes
      the need for `!` assertions in handlers.
- [ ] No `LAB_MODE` branching in this file.
      **Files:** `src/utils/jwt.ts`, `src/middleware/auth.ts`

---

### T-005 — Auth routes: register & login

**Status:** DONE
**Notes:** register/login implemented. Unknown email and wrong password return an identical 401 INVALID_CREDENTIALS, with a dummy bcrypt compare on the missing-user path to avoid a timing oracle. Verified: register 201 (exactly the 5 public keys), duplicate 409, wrong password 401, unknown email 401.
**Depends on:** T-004
**Scope:** `auth.schema.ts`, `auth.service.ts`, `auth.routes.ts`, plus the shared user DTO
(`publicUserSelect`, `toPublicUser`, `PublicUser`) in `users.service.ts`.
**Acceptance criteria:**

- [ ] `POST /api/auth/register` → 201 `{ user: PublicUser, token }`; 409 on duplicate email;
      400 on invalid body. Password hashed with `bcrypt` at `env.BCRYPT_COST`.
- [ ] `POST /api/auth/login` → 200 `{ user: PublicUser, token }`; unknown email and wrong
      password return the **identical** 401 body (`INVALID_CREDENTIALS`).
- [ ] Validation per spec §6 (password 8–72 chars, email lowercased, name trimmed 1–80).
- [ ] `toPublicUser` copies fields explicitly; `passwordHash`/`resetToken` never appear in
      any auth response — verified by inspection in review.
- [ ] Single implementation only (no `LAB_MODE` switch here).
- [ ] Manual check recorded in the task notes: register → login → token verifies.
      **Files:** `src/schemas/auth.schema.ts`, `src/services/auth.service.ts`,
      `src/routes/auth.routes.ts`, `src/services/users.service.ts`, `src/app.ts`

---

### T-006 — Notes router: list, create, and the optional owned-scoped routes

**Status:** DONE
**Notes:** notes router done: list (owner-scoped), create (userId always from req.user — a spoofed `userId` in the body is rejected 400 by strictObject), get-by-id, plus ownership-scoped PATCH/DELETE that 404 when not owned in BOTH modes. Deviation: `createNotesRouter()` takes no `labMode` parameter yet — T-008 adds it, which keeps this run free of dead parameters and keeps the T-008 diff meaningful.
**Depends on:** T-005
**Scope:** `note.schema.ts`, `notes.service.ts` (non-switched operations), and
`createNotesRouter(labMode)` mounted behind `requireAuth`. `GET /api/notes/:id` is
intentionally **not** wired here — it arrives in T-008.
**Acceptance criteria:**

- [ ] `GET /api/notes` returns only `req.user.id`'s notes, `orderBy: { createdAt: 'desc' }`,
      shape `{ notes: [...] }`.
- [ ] `POST /api/notes` → 201 with the created note; validates `title` 1–120,
      `content` 1–10000 via a strict Zod schema.
- [ ] Optional `PATCH`/`DELETE /api/notes/:id` are ownership-scoped with `{ id, userId }`
      (`findFirst` + `updateMany`/`deleteMany`) and return 404 when not owned — in **both**
      modes. These must never become a fourth vulnerability.
- [ ] Router is a factory taking `labMode` (unused so far) so T-008 is a small diff.
- [ ] Mounted at `/api/notes` in `createApp`; every route requires auth.
      **Files:** `src/schemas/note.schema.ts`, `src/services/notes.service.ts`,
      `src/routes/notes.routes.ts`, `src/app.ts`

---

### T-007 — Users router skeleton

**Status:** DONE
**Notes:** `user.schema.ts` `updateMeSchema` is a strictObject + refine, and the users router is wired to the SECURE implementations. Reordering vs the plan, accepted: the secure build was implemented FIRST (this run) and the vulnerable implementations arrive in T-008 as an isolated diff, rather than the other way round. Same end state, and no 501 stubs ever existed.
**Depends on:** T-006
**Scope:** `user.schema.ts` (secure `updateMeSchema` per spec §10 V2) and
`createUsersRouter(labMode)` mounted behind `requireAuth`. The `GET`/`PATCH /api/users/me`
handlers are wired in T-008.
**Acceptance criteria:**

- [ ] `updateMeSchema` uses `z.strictObject` with `name`/`email` optional and a refine
      requiring at least one field; exported for use by the secure service.
- [ ] `UpdateMeParams` / `GetNoteParams` style param types defined so both future
      implementations share one signature.
- [ ] Router factory created, mounted at `/api/users`, auth-protected; no handlers yet
      (or handlers returning 501 that T-008 replaces).
- [ ] No `LAB_MODE` branching yet.
      **Files:** `src/schemas/user.schema.ts`, `src/routes/users.routes.ts`,
      `src/services/users.service.ts`, `src/app.ts`

---

### T-008 — Vulnerable implementations wired to `LAB_MODE`

**Status:** DONE
**Notes:** Implemented and committed in 4b40c7c (the queue was written before the code landed). Reviewer confirmed all three insecure functions are minimal (5, 7 and 5 lines), free of tells, and read as plausible developer mistakes.
**Depends on:** T-007
**Scope:** Add `getNoteByIdInsecure`, `updateMeInsecure`, `getMeInsecure` exactly as
sketched in spec §10, add the three selector functions, and wire the three routes.
Secure twins are stubbed to throw `new Error('not implemented')` until T-009 — or, if
cleaner, the selector temporarily returns the insecure one for both modes; the reviewer
decides, but T-009 must flip it.
**Acceptance criteria:**

- [ ] The three insecure functions match spec §10 shapes: `findUnique` by id only;
      `data: body as Prisma.UserUpdateInput`; raw `findUnique` row returned.
- [ ] No unused variables and no `_`-prefixed parameters — `getNoteByIdInsecure`
      destructures only `noteId` from a shared `{ noteId, userId }` param type.
- [ ] Code reads as an ordinary implementation: no `// VULNERABLE`, `// TODO: fix`, or
      hint comments in the code path; comments, if any, sound like a developer's rationale.
- [ ] Selectors are the **only** `labMode` branch points; no `if (labMode …)` inside any
      handler, service body, or middleware.
- [ ] `GET /api/notes/:id`, `GET /api/users/me`, `PATCH /api/users/me` now respond.
- [ ] With `LAB_MODE=vulnerable`: manual curl shows Alice reading Bob's note,
      `{"role":"ADMIN"}` escalating, and `passwordHash` in `GET /api/users/me`.
- [ ] Each vulnerable function is ≤ ~8 lines (camera constraint, spec G1).
      **Files:** `src/services/notes.service.ts`, `src/services/users.service.ts`,
      `src/routes/notes.routes.ts`, `src/routes/users.routes.ts`

---

### T-009 — Secure implementations

**Status:** DONE
**Notes:** Implemented and committed in d24442b. The secure build was written FIRST and the vulnerable twins added afterwards, which is the reverse of the planned order but reaches the same end state with no stub phase.
**Depends on:** T-008
**Scope:** Implement `getNoteByIdSecure`, `updateMeSecure`, `getMeSecure` per spec §10 and
make the selectors return them when `labMode === 'secure'`.
**Acceptance criteria:**

- [ ] `getNoteByIdSecure` uses `findFirst({ where: { id, userId } })` and throws 404 (not 403) when the note is absent or not owned.
- [ ] `updateMeSecure` parses with `updateMeSchema`, maps `name`/`email` explicitly (no
      spread, no cast), uses `select: publicUserSelect`, and surfaces unknown keys as a
      400 `VALIDATION_ERROR`.
- [ ] `getMeSecure` uses `select: publicUserSelect` **and** `toPublicUser` (defence in depth)
      and returns exactly `id, name, email, role, createdAt`.
- [ ] Both implementations of each operation share one signature and one return contract
      (except the deliberate V3 shape difference).
- [ ] With `LAB_MODE=secure`: the same three curl commands return 404, 400, and a clean
      `PublicUser`; happy paths (own note, name-only update) still work.
- [ ] Diff against T-008 touches only the three service functions, the selectors, and
      `user.schema.ts` — nothing else (protects spec G3).
      **Files:** `src/services/notes.service.ts`, `src/services/users.service.ts`,
      `src/schemas/user.schema.ts`

---

### T-010 — Tests: auth & foundations

**Status:** DONE
**Notes:** tests/helpers/{env,db,app,auth,assertions,error-handler}.ts + tests/auth.test.ts. 24 tests x both lab modes. Uses a separate `prisma/test.db`, plain `prisma db push` (never `--force-reset`), and never depends on `prisma/seed.ts`. Forged-token factories each break exactly one rule and are anchored by a positive control, so the six 401 cases cannot pass for the wrong reason. `globalSetup` was deliberately NOT wired into vitest.config.ts; `ensureTestDatabase()` is memoised in each beforeAll instead.
**Depends on:** T-009
**Scope:** Test helpers (app factories for both modes, DB reset, register+login) and
`tests/auth.test.ts` covering A1–A6 in spec §12, parameterised over both lab modes.
**Acceptance criteria:**

- [ ] `globalSetup` applies the schema to a dedicated test DB (`prisma db push --force-reset`);
      test env sets `BCRYPT_COST=4` and a test `JWT_SECRET`.
- [ ] `beforeEach` truncates `Note` then `User`; tests never rely on `prisma/seed.ts`.
- [ ] A1–A6 implemented as described, including the exact-keys assertion on the register
      response and the no-user-enumeration assertion.
- [ ] Token tampering cases covered: wrong secret, `alg: none`, expired, malformed header.
- [ ] Suite passes against **both** `labMode` values via `describe.each`.
- [ ] Supertest runs against `createApp(...)` — no real port is opened.
      **Files:** `tests/helpers/app.ts`, `tests/helpers/db.ts`, `tests/helpers/auth.ts`,
      `tests/auth.test.ts`, `vitest.config.ts`

---

### T-011 — Tests: vulnerable behaviour

**Status:** DONE
**Notes:** tests/vulnerable.test.ts — 18 tests. All three exploits proven, plus negative controls asserting the lab ships exactly three bugs: owner-scoped list, cross-user PATCH/DELETE 404 with the note surviving, spoofed `userId` on create rejected, every protected route 401 without a token, and no stack trace or filesystem path in any error body.
**Depends on:** T-010
**Scope:** `tests/vulnerable.test.ts` — proves each of the three exploits succeeds in
`labMode: 'vulnerable'`, plus the negative controls that prove the lab has only three bugs.
**Acceptance criteria:**

- [ ] V1: Alice reads Bob's note → 200 and `body.content` equals Bob's content.
- [ ] V2: `PATCH {"role":"ADMIN"}` → 200; follow-up `GET /api/users/me` **and** a direct
      Prisma read both report `ADMIN`; the `{"name":…,"role":…}` mixed-payload variant too.
- [ ] V3: `GET /api/users/me` body contains `passwordHash` and `resetToken`, and
      `passwordHash` equals the stored hash.
- [ ] Negative controls pass: `GET /api/notes` still leaks nothing across users;
      `DELETE /api/notes/<bob's>` → 404 and Bob's note survives; no error response contains
      a stack trace or filesystem path.
- [ ] Every test title states the lesson (usable as on-screen captions).
      **Files:** `tests/vulnerable.test.ts`

---

### T-012 — Tests: secure behaviour

**Status:** DONE
**Notes:** tests/secure.test.ts — 19 tests. S1 404 with a body byte-identical to the nonexistent-id 404 (no existence oracle); S2 400 VALIDATION_ERROR with `details[].path === "role"` and the row unchanged; S3 exact-key assertion on GET and PATCH; S4 reworked after the body-parser fix — malformed JSON now 400 INVALID_JSON, oversized body 413 PAYLOAD_TOO_LARGE with the row provably not written, and the 500 fallback covered as a direct unit test on `errorHandler` asserting the stack reaches stderr and never the client.
**Depends on:** T-011
**Scope:** `tests/secure.test.ts` — same requests under `labMode: 'secure'`, asserting
S1–S4 from spec §12.
**Acceptance criteria:**

- [ ] S1: cross-user note → 404 with none of Bob's content in the body; own note → 200.
- [ ] S2: `{"role":"ADMIN"}` → 400 `VALIDATION_ERROR` with an issue path naming `role`, and
      the DB role is still `USER`; `{"name":"Alice2"}` → 200 with the name changed; `{}` → 400.
- [ ] S3: exact-key assertion — `Object.keys(body).sort()` deep-equals
      `['createdAt','email','id','name','role']`.
- [ ] S4: a forced unhandled error returns the generic 500 envelope with no `stack` key.
- [ ] `pnpm test` runs all three test files in one command and is green (spec G2).
- [ ] `pnpm typecheck` and `pnpm lint` clean.
      **Files:** `tests/secure.test.ts`

---

### T-013 — Docker & compose (localhost-bound)

**Status:** DONE
**Notes:** Verified end to end. `docker build` succeeds and the container serves both modes: vulnerable mode reproduces the IDOR (200 on Bob's note) and the passwordHash leak; secure mode returns 404. Runs as uid 1000 (node), published on 127.0.0.1 only. Safety interlocks confirmed inside the container: NODE_ENV=production + LAB_MODE=vulnerable refuses to start, and a short JWT_SECRET refuses to start. Three build problems were found and fixed: pnpm's minimumReleaseAge policy rejected superagent@10.4.1 (pinned to 10.3.0 via a pnpm override rather than disabling the policy); corepack pulled pnpm 12 in the image while the repo used 10 (pinned with a `packageManager` field); and the Prisma client is now generated in the runtime stage instead of copied, since pnpm does not place it at node_modules/.prisma. Image trimmed 1.42GB -> 802MB by pruning the pnpm store and narrowing a recursive chown. `prisma` and `tsx` moved to dependencies because the entrypoint needs them; the runtime stage installs --prod only, so no test tooling ships in the image.
**Depends on:** T-012
**Scope:** Multi-stage `Dockerfile` and a `docker-compose.yml` that cannot be exposed by
accident.
**Acceptance criteria:**

- [ ] Multi-stage build (deps → build → runtime), `node:20-alpine` or `-slim`, runs as a
      non-root user, `NODE_ENV=production` in the runtime stage.
- [ ] Prisma client generated at build time; SQLite file on a named volume or bind mount.
- [ ] Entrypoint applies the schema and optionally seeds before starting.
- [ ] `docker-compose.yml` publishes **`127.0.0.1:3000:3000`** — a comment above the line
      explains why the host binding must never be removed.
- [ ] `LAB_MODE` passed through from `.env`, defaulting to `secure`.
- [ ] `docker compose config` validates; `docker compose up` serves `GET /health` on
      `http://127.0.0.1:3000/health` and is unreachable from the host's LAN IP.
- [ ] `.dockerignore` excludes `node_modules`, `.env`, `*.db`, `dist`, `.git`.
      **Files:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`

---

### T-014 — README & SECURITY.md

**Status:** DONE
**Notes:** README.md and SECURITY.md written, then given an editorial pass. Warning block is first in the README.
**Depends on:** T-013
**Scope:** The two top-level documents a visitor sees first.
**Acceptance criteria:**

- [ ] `README.md` opens with a prominent warning block (before any other content):
      intentionally vulnerable, educational only, localhost only, never deploy, never use
      against systems you do not own.
- [ ] Quickstart works verbatim from a clean clone: install, `.env` copy, db reset+seed, dev.
- [ ] Documents `LAB_MODE` (default `secure`), the seed accounts and their lab-only
      passwords, the npm scripts, and the Docker path.
- [ ] Lists the three vulnerabilities with links to `docs/vulnerabilities.md` and states
      plainly that everything else is implemented securely.
- [ ] Explains the three branches and links `docs/lab-guide.md`.
- [ ] `SECURITY.md`: no supported versions, the known vulnerabilities are intentional and
      out of scope for reports, how to report an **unintended** one, and a do-not-deploy
      statement.
- [ ] No real secrets, no real hostnames, no third-party targets in either file.
      **Files:** `README.md`, `SECURITY.md`

---

### T-015 — docs/architecture.md, docs/vulnerabilities.md, docs/lab-guide.md

**Status:** DONE
**Notes:** Docs corrected against the reviewer findings and re-verified against the code.
**Notes:** architecture.md, vulnerabilities.md, lab-guide.md written and edited. Orchestrator then corrected architecture.md where it had gone stale against the JWT fix (payload/issuer) and added the INVALID_JSON / PAYLOAD_TOO_LARGE rows to the error mapping table.
**Depends on:** T-014
**Scope:** The teaching documentation that the video scripts draw from.
**Acceptance criteria:**

- [ ] `architecture.md`: layer diagram (routes → services → Prisma), the `LAB_MODE`
      selector design, auth design, error-handling design, and a **decisions &
      simplifications** section recording: no stack traces in either mode, no rate limiting,
      no refresh tokens, SQLite-has-no-enums, DB-read of `role` in middleware.
- [ ] `vulnerabilities.md`: one section per vulnerability with cause, vulnerable snippet,
      exploit request, secure snippet, why the mistake is realistic, OWASP API Top 10
      reference, and how to verify the fix. States that `ADMIN` grants no extra power here
      and why that does not lessen the finding.
- [ ] `lab-guide.md`: copy-paste `curl` walkthrough per episode (register/login, capture
      token, run each exploit in `vulnerable`, re-run in `secure`), expected output for each
      command, and the **branch-cut procedure** from spec §13 as numbered steps.
- [ ] All commands target `http://127.0.0.1:3000` only.
- [ ] Documentation matches the shipped code (reviewer cross-checks snippets against `src/`).
      **Files:** `docs/architecture.md`, `docs/vulnerabilities.md`, `docs/lab-guide.md`

---

### T-016 — Cut the `vulnerable` and `secure` demo branches

**Status:** DONE
**Notes:** Both demo branches cut from main. Each keeps one implementation of the three switched operations, renamed to the neutral name, with the selectors and all LAB_MODE plumbing removed. The vulnerability suite is `tests/vulnerability.test.ts` on both branches so the filename does not appear in the diff; `tests/auth.test.ts` is de-parameterised. Verified green on all three: main 85 tests, vulnerable 42, secure 43, with typecheck, lint and format clean on each. **The teaching diff** — `git diff vulnerable secure -- src/services src/schemas` touches exactly three files (notes.service.ts, users.service.ts, user.schema.ts), 37 insertions / 7 deletions, inside the spec's ~40-line target. The wider `-- src/` diff also shows `env.ts` (the production guard is vulnerable-only) and `server.ts` (the warning banner is vulnerable-only). That is expected and worth explaining on camera rather than engineering away.
**Depends on:** T-015
**Scope:** Run `pnpm format` on `main`, then create both branches per the stripping rules
in spec §13.
**Acceptance criteria:**

- [ ] `main` is formatted and green before cutting.
- [ ] On each branch: the opposite implementation is deleted, the survivor renamed to the
      neutral name, selectors removed, routes call services directly, `labMode` removed from
      `createApp`/routers/`/health`/`env.ts`/`.env.example`.
- [ ] The vulnerability test file is named `tests/vulnerability.test.ts` on **both** branches;
      `tests/auth.test.ts` is de-parameterised to a single app.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass on `main`, `vulnerable`, and `secure`.
- [ ] `git diff vulnerable secure -- src/` touches only `src/services/notes.service.ts`,
      `src/services/users.service.ts`, `src/schemas/user.schema.ts` and is ≤ ~40 changed
      lines (spec G3). Paste the diff stat into the task notes.
- [ ] The `vulnerable` branch keeps the startup warning banner; `secure` does not.
- [ ] The exact commands used are recorded in `docs/lab-guide.md` so the cut is repeatable.
      **Files:** git refs only; `docs/lab-guide.md` (command log)

---

### T-017 — Final consistency & safety review

**Status:** DONE
**Notes:** **APPROVED** on the round-two review. The reviewer re-verified every round-one finding against the code and by execution, and re-ran the unintended-vulnerability sweep against the final state including both freshly-cut demo branches. Result: exactly three vulnerabilities on `main` and on `vulnerable`, and **zero on `secure`**. The vulnerable branch keeps every safety property (banner, loopback bind, production refusal — the last is now stronger, since it no longer depends on a mode variable). Residual polish from that round (Zod 4 error text, SECURITY.md binding wording, the missing error-table row, the overstated diff command, and the Prisma logger printing service source to the recording terminal) is fixed. OQ-1 and OQ-2 are resolved and recorded in spec §14.
**Depends on:** T-016
**Scope:** Whole-repo pass against the spec before the series is recorded. Reviewer-led; any
defect becomes a new task (T-018+) rather than an in-place fix by the reviewer.
**Acceptance criteria:**

- [ ] Exactly three vulnerabilities exist. Explicit re-check for: SQLi, weak/hardcoded JWT
      secret, `alg` confusion, plaintext or weak password hashing, CORS misconfiguration,
      stack-trace leakage, `passwordHash` in any auth or notes response, IDOR on the
      optional note routes, and mass assignment on `POST /api/notes`.
- [ ] Binding is `127.0.0.1` in `server.ts`, `docker-compose.yml`, and every doc command.
- [ ] `git grep -nE "(password|secret|token)\s*[:=]"` surfaces nothing that is not an
      obviously fake lab value; `.env` is not committed; no `*.db` is committed.
- [ ] Every spec §6 route behaves as tabled in both modes.
- [ ] Docs snippets match the shipped code line-for-line.
- [ ] `pnpm install --frozen-lockfile && pnpm db:reset && pnpm test` green from a clean clone.
- [ ] Each vulnerable function still fits on one screen at presentation font size (spec G1).
- [x] Spec open questions OQ-1 and OQ-2 are resolved and recorded (spec §14).
      **Files:** repo-wide (review only)

---

## Backlog / not scheduled

- B-01 — Episode scripts and on-screen captions derived from `docs/vulnerabilities.md`.
- B-02 — Optional GitHub Actions workflow running `typecheck`, `lint`, `test` on all three
  branches. Add only if the human asks; it is not needed for the series.

---

### T-018 — Reviewer code fixes

**Status:** DONE
**Depends on:** T-017 (first round)
**Notes:** B1 `listNotes` now orders by `[{createdAt:'desc'},{id:'desc'}]` — the seed writes a user's notes with an identical timestamp, so `createdAt` alone left the order to SQLite's rowid and the documented `3 / 2 / 1` walkthrough output was wrong. S1 `PrismaClientValidationError` maps to 400 `BAD_REQUEST`, so a non-object PATCH body (no `Content-Type`, or `[]`) no longer 500s in vulnerable mode and no longer dumps the vulnerable function's source to the terminal mid-recording. N1 removed the unused `isVulnerableMode` export. N2 `app.disable('x-powered-by')`. N3 `JWT_EXPIRES_IN` is regex-validated so a bad value fails at boot instead of at the first login. 4xx now logs a one-line summary instead of a full error dump. `prisma/seed.ts` uses `$executeRaw` instead of `$executeRawUnsafe` — same query, one less thing to explain.
**Verified:** 85/85 tests green; note order is `3,2,1`; both S1 repros return 400; `x-powered-by` absent; all three vulnerabilities still fire.

---

### T-019 — Reviewer documentation fixes

**Status:** DONE
**Notes:** All findings addressed. The re-parenting exploit was confirmed by hand in both modes (200 and the note moves in vulnerable; 400 and it does not in secure) before being published as a demo.
**Depends on:** T-017 (first round)
**Scope:** B3 (lab guide named the wrong default mode), B4 (the "ownership enforced in both modes" claim is falsified by V2 reaching Prisma nested relation writes — `{"notes":{"connect":{"id":N}}}` re-parents another user's note), S2, S4 (SQLite enums are NOT load-bearing for V2 — the cast is), S5 (the binding claim is not absolute), S9, S10 (narrow "no user enumeration" to login), S12, S7 (branch-cut procedure), plus snippet drift and the Docker profile change.

---

### T-020 — Repo hygiene

**Status:** DONE
**Depends on:** T-017 (first round)
**Notes:** Added `LICENSE` (MIT) — `SECURITY.md` linked it and `package.json` declared it, but the file did not exist. Added `.remember` and `docs/specs` to `.prettierignore` so `pnpm format` cannot rewrite agent scratch files. `docker-compose.yml` is now fail-closed: both services are profile-gated, so a bare `docker compose up` starts nothing instead of handing over the vulnerable build, and `LAB_MODE` is overridable via `${LAB_MODE:-vulnerable}`. Task statuses in this file brought in line with the committed code so a file-only resume cannot re-implement finished work.
