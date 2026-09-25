# Vulnerable Notes API

> **You are on the `vulnerable` branch.** Every switched endpoint here uses the
> insecure implementation. The fixed code lives on the `secure` branch, and the
> full lab with both implementations lives on `main`.

A small, intentionally insecure Node.js + TypeScript REST API that demonstrates three real application-security bugs — and their fixes — from the perspective of the developer who writes them.

> ### ⚠️ EDUCATIONAL SECURITY LAB
>
> This repository **intentionally contains insecure code**. The vulnerabilities are deliberate and documented.
>
> - Run the vulnerable build **only** on `127.0.0.1`, on a machine you own and control.
> - **Never** deploy it to a public-facing server or any internet-connected host.
> - **Never** use these techniques against systems you do not own or are not authorised to test.
> - Do not use this code as a template for a real application.
>
> Found a bug that is _not_ one of the three documented ones? See [SECURITY.md](SECURITY.md).

---

## Vulnerabilities demonstrated

Each one is a few lines of code, paired with its secure fix and selected at runtime by `LAB_MODE`.

| #      | Vulnerability                            | Endpoint              | OWASP API Top 10 | The mistake                                                             |
| ------ | ---------------------------------------- | --------------------- | ---------------- | ----------------------------------------------------------------------- |
| **V1** | Broken Object Level Authorization (IDOR) | `GET /api/notes/:id`  | API1:2023        | The note is looked up by id alone — ownership is never checked          |
| **V2** | Mass Assignment / privilege escalation   | `PATCH /api/users/me` | API3:2023        | `req.body` is passed straight into `prisma.user.update`                 |
| **V3** | Excessive Data Exposure                  | `GET /api/users/me`   | API3:2023        | The raw Prisma row is returned, leaking `passwordHash` and `resetToken` |

Full write-ups — root cause, reproduction, impact, fix — are in **[docs/vulnerabilities.md](docs/vulnerabilities.md)**.

### What is deliberately _not_ vulnerable

Everything else is implemented correctly, on purpose. The lesson is authorization and serialization, not broken authentication.

- **JWT** — HS256 with the algorithm _and_ issuer pinned, proper expiry, secret from the environment, payload carries only a subject
- **Passwords** — bcrypt in both modes, never stored in plaintext
- **Login** — an unknown email and a wrong password return the identical 401 (no user enumeration)
- **Note ownership** — list, update and delete are scoped to the authenticated user in both modes
- **Note creation** — `userId` comes from the verified token; a spoofed `userId` in the body is rejected
- **Errors** — centralized handling; no stack trace or file path ever reaches an HTTP response

---

## Quick Start

**Prerequisites:** Node.js 20+, [pnpm](https://pnpm.io/installation), and Git.

```bash
git clone https://github.com/sakin-hossain/vulnerable-notes-api.git
cd vulnerable-notes-api

pnpm install
cp .env.example .env
pnpm db:reset          # creates the SQLite database and seeds Alice and Bob

pnpm lab:vulnerable    # http://127.0.0.1:3000
```

Confirm which build is live at any time:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok","labMode":"vulnerable"}
```

> The API has no frontend and no `/` route by design, so opening `http://127.0.0.1:3000` in a browser returns a `404` envelope. That is expected — use `curl`, Postman, or Burp Repeater. `/health` is the only route a browser can usefully open.

### Seed accounts

Lab-only credentials. Both users have the same password.

| User  | Email                 | Password       | User id | Owns notes  |
| ----- | --------------------- | -------------- | ------- | ----------- |
| Alice | `alice@example.local` | `Password123!` | 1       | **1, 2, 3** |
| Bob   | `bob@example.local`   | `Password123!` | 2       | **4, 5, 6** |

Note ids are deterministic: the seed truncates both tables and resets SQLite's autoincrement counters, so Alice is always 1–3 and Bob is always 4–6. That is what makes "change the id from `1` to `4`" reproducible on camera. Re-run `pnpm db:seed` any time you have mutated the data. To list the ids yourself:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/notes | jq '.notes[].id'
```

---

## Vulnerable vs secure mode

One environment variable, `LAB_MODE`, selects which implementation the three affected routes use. It **defaults to `secure`** — the vulnerable build must be opted into explicitly.

```bash
pnpm lab:secure        # the fixed build
pnpm lab:vulnerable    # the insecure build (prints a warning banner to stderr)
```

The same three requests, side by side:

| Request (as Alice)                       | Vulnerable                         | Secure                                     |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `GET /api/notes/4` (Bob's note)          | `200` + Bob's note                 | `404`                                      |
| `GET /api/users/me`                      | leaks `passwordHash`, `resetToken` | exactly `id, name, email, role, createdAt` |
| `PATCH /api/users/me` `{"role":"ADMIN"}` | `200`, role becomes `ADMIN`        | `400 VALIDATION_ERROR`, role unchanged     |

Two demo branches hold the code with the switch stripped out, so the fix is a clean diff:

```bash
git switch vulnerable   # only the insecure implementation
git switch secure       # only the fixed implementation

git diff vulnerable secure -- src/services src/schemas
# 3 files changed, 37 insertions(+), 7 deletions(-)
```

---

## API overview

All bodies are JSON. Every route except `/health` and `/api/auth/*` requires `Authorization: Bearer <token>`.

| Method   | Path                 | Auth | Purpose                                      |
| -------- | -------------------- | ---- | -------------------------------------------- |
| `POST`   | `/api/auth/register` | —    | Create an account, returns `{ user, token }` |
| `POST`   | `/api/auth/login`    | —    | Log in, returns `{ user, token }`            |
| `GET`    | `/api/users/me`      | ✓    | Current user's profile — **V3**              |
| `PATCH`  | `/api/users/me`      | ✓    | Update own profile — **V2**                  |
| `GET`    | `/api/notes`         | ✓    | List the caller's own notes                  |
| `POST`   | `/api/notes`         | ✓    | Create a note                                |
| `GET`    | `/api/notes/:id`     | ✓    | Fetch one note — **V1**                      |
| `PATCH`  | `/api/notes/:id`     | ✓    | Update own note                              |
| `DELETE` | `/api/notes/:id`     | ✓    | Delete own note                              |
| `GET`    | `/health`            | —    | Liveness plus the active `labMode`           |

Resources are wrapped (`{ user }`, `{ note }`, `{ notes }`). Errors use one envelope:

```json
{ "error": { "message": "Note not found", "code": "NOT_FOUND" } }
```

Copy-paste request and response examples for every endpoint are in **[docs/lab-guide.md](docs/lab-guide.md)**.

---

## Tests

85 tests prove both the exploits and the fixes in a single run, by mounting a vulnerable app and a secure app against the same database.

```bash
pnpm test          # run once
pnpm test:watch    # watch mode
```

| Suite                      | What it proves                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tests/vulnerable.test.ts` | Each exploit succeeds, plus negative controls asserting the lab has exactly three bugs               |
| `tests/secure.test.ts`     | The same requests are blocked — 404, 400, and a five-key user object                                 |
| `tests/auth.test.ts`       | Authentication is correct in both modes: forged, expired, wrong-issuer and `alg:none` tokens all 401 |

The suite uses its own `prisma/test.db` and never touches your seeded lab data.

---

## Documentation

| Document                                               | Contents                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **[docs/vulnerabilities.md](docs/vulnerabilities.md)** | Per-vulnerability: root cause, vulnerable code, reproduction, impact, secure fix, lesson |
| **[docs/lab-guide.md](docs/lab-guide.md)**             | Copy-paste `curl` walkthrough for each vulnerability, plus raw Burp Repeater requests    |
| **[docs/architecture.md](docs/architecture.md)**       | Layers, the `LAB_MODE` selector design, auth and error handling, design decisions        |
| **[SECURITY.md](SECURITY.md)**                         | What is intentional, and how to report an _unintended_ vulnerability                     |

---

## Tech stack

Node.js 20+ · TypeScript 5.9 (strict) · Express 5.2 · Prisma 6.19 + SQLite · Zod 4.6 · bcrypt 6 · jsonwebtoken 9 · Vitest 3.2 + Supertest · Docker · pnpm

### Project layout

```
src/
├── server.ts            # bootstrap: loopback bind, warning banner, graceful shutdown
├── app.ts               # createApp({ labMode }) — a factory, so tests mount both builds
├── config/env.ts        # Zod-validated environment, fails closed to secure
├── middleware/          # requireAuth (JWT + DB lookup), centralized error handler
├── routes/              # auth · users · notes
├── schemas/             # Zod contracts — user.schema.ts is the V2 fix
├── services/            # notes.service.ts (V1) · users.service.ts (V2, V3)
└── utils/jwt.ts         # HS256, algorithm and issuer pinned
```

The three switched operations each resolve through a single selector, so `LAB_MODE` is never read inside a handler, a service body, or middleware.

---

## Scripts

| Command                                        | What it does                                                   |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `pnpm lab:vulnerable` / `pnpm lab:secure`      | Start the API in a specific mode                               |
| `pnpm dev`                                     | Start using whatever `LAB_MODE` your `.env` sets               |
| `pnpm db:reset`                                | Sync the schema and re-seed (`prisma db push && pnpm db:seed`) |
| `pnpm db:seed`                                 | Re-seed only — resets Alice and Bob to a known state           |
| `pnpm db:nuke`                                 | Delete `prisma/dev.db`, then rebuild and re-seed it            |
| `pnpm db:studio`                               | Browse the database in Prisma Studio                           |
| `pnpm test` / `pnpm test:watch`                | Run the test suite                                             |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | Quality gates                                                  |
| `pnpm build` / `pnpm start`                    | Compile to `dist/` and run the compiled server                 |

The lab uses `prisma db push` rather than a migration history — it is a disposable SQLite teaching database, and the seed is the source of truth. `pnpm prisma db seed` also works if you prefer the Prisma CLI directly.

## Environment variables

Copy `.env.example` to `.env`. Every value in it is a fake, lab-only placeholder.

| Variable         | Default              | Notes                                                    |
| ---------------- | -------------------- | -------------------------------------------------------- |
| `DATABASE_URL`   | `file:./dev.db`      | SQLite file used by Prisma                               |
| `JWT_SECRET`     | _(fake value)_       | Minimum 32 characters, enforced at boot                  |
| `JWT_EXPIRES_IN` | `1h`                 | Validated at boot                                        |
| `BCRYPT_COST`    | `12`                 | Tests drop this to 4 for speed                           |
| `LAB_MODE`       | `secure`             | **Fails closed.** `.env.example` opts in to `vulnerable` |
| `PORT` / `HOST`  | `3000` / `127.0.0.1` | Loopback by default                                      |
| `NODE_ENV`       | `development`        | `production` + `vulnerable` refuses to start             |

## Docker

Both services are profile-gated, so a bare `docker compose up` starts nothing rather than silently handing you the insecure build.

```bash
docker compose --profile vulnerable up   # http://127.0.0.1:3000
docker compose --profile secure up       # http://127.0.0.1:3001
```

The image sets `HOST=0.0.0.0` internally; what keeps it local is the `127.0.0.1:` prefix on the published port. If you run the image by hand, keep that prefix:

```bash
docker run -p 127.0.0.1:3000:3000 vulnerable-notes-api   # correct
docker run -p 3000:3000 vulnerable-notes-api             # WRONG — exposes it to your network
```

---

## Learning objectives

After working through this lab you should be able to:

1. Explain why **authentication is not authorization**, and spot a missing object-level ownership check in a code review.
2. Scope an object lookup to the authenticated user, and say why a `404` beats a `403` when the resource exists but is not yours.
3. Recognise mass assignment, and explain why the server — not the client, and not the frontend form — decides which fields may be written.
4. Apply an explicit allowlist rather than a denylist, and know why `data: { ...input }` still fails the test that `data: { name: input.name }` passes.
5. Treat the response shape as a deliberate decision, using `select` and a DTO instead of serialising an ORM model.
6. Explain why a leaked `passwordHash` still matters even though it is hashed, and why a leaked `resetToken` is an account-takeover primitive.
7. Write tests that prove both the exploit and the fix.

## YouTube series

Part of **Cybersecurity for Developers** — a "Build → Break → Secure" series.

**Walkthrough video: coming soon.**

## Contributing

This is a teaching lab with a deliberately fixed scope: three vulnerabilities, no more. Corrections to the documentation, the tests, or the _non-vulnerable_ code are welcome. Please do not submit pull requests that add further vulnerabilities.

## License

[MIT](LICENSE) — free to use for teaching, learning, and training.

## Disclaimer

This software is provided for **education only**. The insecure code paths exist to be studied, not shipped. You are responsible for how you run it: keep it on a machine you own, keep it off the public internet, and only ever test systems you have explicit permission to test. The author accepts no liability for misuse or for any damage resulting from running this software.
