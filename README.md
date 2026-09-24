# Vulnerable Node.js API Lab

> **WARNING — EDUCATIONAL SECURITY LAB**
>
> This repository contains **intentionally vulnerable code** designed for teaching purposes only. The vulnerabilities documented here are deliberately introduced and must NOT be deployed to production or any system you do not own and control.
>
> - **Never** run the vulnerable build (`LAB_MODE=vulnerable`) on a public-facing server or internet-connected machine.
> - **Only** run it on `127.0.0.1` on a machine you own completely.
> - **Do not** use this code as a template for real applications.
> - If you discover an **unintended** vulnerability, see [SECURITY.md](SECURITY.md).

---

## Overview

**Vulnerable Node.js API Lab** is a small, intentionally insecure REST API that teaches developers how real security vulnerabilities work and how to fix them. It demonstrates three common authorization and data-exposure bugs from the perspective of a working developer under deadline — mistakes that are easy to make but critical to understand.

The lab is part of the **Cybersecurity for Developers** YouTube series.

### The three vulnerabilities

| Vulnerability                                    | Endpoint              | OWASP Ref | Issue                                                                   |
| ------------------------------------------------ | --------------------- | --------- | ----------------------------------------------------------------------- |
| **V1: Broken Object Level Authorization (IDOR)** | `GET /api/notes/:id`  | API1:2023 | User can read another user's notes by guessing the note ID              |
| **V2: Mass Assignment / Privilege Escalation**   | `PATCH /api/users/me` | API3:2023 | Client can escalate their role to `ADMIN` by sending `{"role":"ADMIN"}` |
| **V3: Excessive Data Exposure**                  | `GET /api/users/me`   | API3:2023 | Password hash and reset token are leaked in the response                |

Each vulnerability is 2–8 lines of code, readable on camera, paired with its secure fix.

### What is NOT vulnerable

The following are implemented correctly:

- **JWT authentication** — HS256 pinning, proper expiry, secrets from environment
- **Password hashing** — bcrypt with configurable cost, no plaintext passwords
- **Login security** — identical error messages for unknown email and wrong password on login (no enumeration via login)
- **Note ownership** — enforced on note routes themselves (list/update/delete) in both modes; in vulnerable mode V2 can still re-parent notes via nested relation writes
- **Validation** — strict schemas with type safety via Zod
- **Error handling** — no stack traces leaked over HTTP in either mode
- **Server binding** — defaults to `127.0.0.1`; under Docker, safety comes from the loopback publish prefix

---

## Tech Stack

- **Node.js** 20 LTS+ (CommonJS)
- **TypeScript** 5.9 (strict mode)
- **Express** 5.2
- **Prisma** 6.19 + SQLite
- **Zod** 4.6 (validation)
- **bcrypt** 6.0 (password hashing)
- **jsonwebtoken** 9.0 (JWT signing/verification)
- **Vitest** 3.2 + Supertest (testing)
- **Docker** (multi-stage build)

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)

### Installation

```bash
git clone <repo-url>
cd vulnerable-node-api-lab

# Install dependencies
pnpm install

# Copy the example environment file
cp .env.example .env

# Initialize the database and seed it with test users
pnpm db:reset

# Start the lab
pnpm dev
```

The server will start on `http://127.0.0.1:3000`.

Check the server health:

```bash
curl http://127.0.0.1:3000/health
```

Expected output:

```json
{ "status": "ok", "labMode": "vulnerable" }
```

Note: The output is `"vulnerable"` because the Quick Start copies `.env.example`, which explicitly sets `LAB_MODE="vulnerable"` to opt in to the vulnerable build. If `LAB_MODE` is unset, the lab defaults to `"secure"` (fail-closed).

### Seed Accounts

Two test accounts are created by `pnpm db:reset`:

| Email                 | Password       | User ID | Owns Notes |
| --------------------- | -------------- | ------- | ---------- |
| `alice@example.local` | `Password123!` | 1       | 1, 2, 3    |
| `bob@example.local`   | `Password123!` | 2       | 4, 5, 6    |

These are **lab-only credentials**. Never reuse them outside the lab.

---

## Lab Modes

The lab runs in two modes, controlled by the `LAB_MODE` environment variable:

### Secure Mode (Default)

```bash
LAB_MODE=secure pnpm dev
# or: pnpm lab:secure
```

All vulnerabilities are fixed. This is the default if `LAB_MODE` is not set.

### Vulnerable Mode

```bash
LAB_MODE=vulnerable pnpm dev
# or: pnpm lab:vulnerable
```

The three vulnerabilities are active. A large banner prints to stderr on startup, making it impossible to run unaware.

---

## API Reference

Base URL: `http://127.0.0.1:3000/api`

All endpoints except authentication require an `Authorization: Bearer <token>` header.

### Authentication

#### POST `/auth/register`

Register a new user.

```bash
curl -X POST http://127.0.0.1:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Charlie",
    "email": "charlie@example.local",
    "password": "SecurePass123!"
  }'
```

Response: `201 Created`

```json
{
  "user": {
    "id": 3,
    "name": "Charlie",
    "email": "charlie@example.local",
    "role": "USER",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### POST `/auth/login`

Log in and receive a JWT.

```bash
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.local",
    "password": "Password123!"
  }'
```

Response: `200 OK`

```json
{
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.local",
    "role": "USER",
    "createdAt": "..."
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Users

#### GET `/users/me`

Retrieve the authenticated user's profile.

```bash
curl -X GET http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN"
```

Response: `200 OK` (secure mode)

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

**Vulnerable mode** leaks `passwordHash` and `resetToken`.

#### PATCH `/users/me`

Update the authenticated user's name or email.

```bash
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Updated"}'
```

Response: `200 OK`

**Vulnerable mode** accepts any field, including `{"role":"ADMIN"}`.

### Notes

#### GET `/notes`

List all notes owned by the authenticated user.

```bash
curl -X GET http://127.0.0.1:3000/api/notes \
  -H "Authorization: Bearer $TOKEN"
```

Response: `200 OK`

```json
{
  "notes": [
    {
      "id": 3,
      "title": "Weekend reading list",
      "content": "A few articles to read this weekend.",
      "userId": 1,
      "createdAt": "2024-01-15T10:15:00.000Z",
      "updatedAt": "2024-01-15T10:15:00.000Z"
    }
  ]
}
```

Notes are always returned in reverse-chronological order.

#### POST `/notes`

Create a new note.

```bash
curl -X POST http://127.0.0.1:3000/api/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My note",
    "content": "Note content here"
  }'
```

Response: `201 Created`

#### GET `/notes/:id`

Retrieve a note by ID.

```bash
curl -X GET http://127.0.0.1:3000/api/notes/1 \
  -H "Authorization: Bearer $TOKEN"
```

Response: `200 OK` (secure) — only if the note is owned by the user
Response: `404 Not Found` (secure) — if the note doesn't exist or isn't owned
Response: `200 OK` (vulnerable) — **any** note, owned or not (V1)

#### PATCH `/notes/:id`

Update a note (must be owned).

```bash
curl -X PATCH http://127.0.0.1:3000/api/notes/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated title"}'
```

#### DELETE `/notes/:id`

Delete a note (must be owned).

```bash
curl -X DELETE http://127.0.0.1:3000/api/notes/1 \
  -H "Authorization: Bearer $TOKEN"
```

Response: `204 No Content`

### Health

#### GET `/health`

Check server status and lab mode.

```bash
curl http://127.0.0.1:3000/health
```

Response: `200 OK`

```json
{ "status": "ok", "labMode": "vulnerable" }
```

---

## Demonstrating the Vulnerabilities

Detailed walkthroughs for each vulnerability are in [docs/lab-guide.md](docs/lab-guide.md).

### Quick example: V1 — IDOR

In vulnerable mode, Alice's token can read Bob's note:

```bash
# Get Alice's token
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

# Alice tries to read Bob's note (id 4)
curl http://127.0.0.1:3000/api/notes/4 -H "Authorization: Bearer $TOKEN"
# Vulnerable mode: 200 OK, returns Bob's note
# Secure mode: 404 Not Found
```

---

## Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode
pnpm test:watch
```

Tests are located in `tests/` and cover:

- **Auth security** — password hashing, JWT, token validation (both modes)
- **Vulnerable behaviour** — proves all three exploits work in vulnerable mode
- **Secure fixes** — proves all three are fixed in secure mode

---

## Docker

### Using docker-compose

Run the lab in vulnerable mode:

```bash
docker compose --profile vulnerable up
```

This starts the vulnerable instance at `http://127.0.0.1:3000`.

Run in secure mode:

```bash
docker compose --profile secure up
```

The secure instance runs at `http://127.0.0.1:3001`.

Both modes bind to `127.0.0.1` by default (loopback only) via the `127.0.0.1:` prefix in the port mapping. This prevents exposure to the local network.

### Using docker run directly

If running the image without docker-compose, **use loopback binding** to keep the vulnerable API isolated:

```bash
# CORRECT — binds to loopback only
docker run -p 127.0.0.1:3000:3000 vulnerable-node-api-lab

# WRONG — exposes to the local network and any attacker on it
docker run -p 3000:3000 vulnerable-node-api-lab
```

Always use the `127.0.0.1:` prefix in the `-p` flag when running the vulnerable build.

---

## Repository Structure

```
.
├─ README.md                          # This file
├─ SECURITY.md                        # Security policy
├─ .env.example                       # Example environment variables
├─ package.json                       # Dependencies and scripts
├─ pnpm-lock.yaml
├─ tsconfig.json
├─ vitest.config.ts
├─ Dockerfile                         # Multi-stage container build
├─ docker-compose.yml
├─ src/
│  ├─ server.ts                       # HTTP server entry point
│  ├─ app.ts                          # Express app factory
│  ├─ config/env.ts                   # Environment configuration
│  ├─ lib/prisma.ts                   # Prisma client singleton
│  ├─ middleware/
│  │  ├─ auth.ts                      # JWT middleware
│  │  └─ error-handler.ts             # Error handling
│  ├─ routes/
│  │  ├─ auth.routes.ts               # /auth endpoints
│  │  ├─ users.routes.ts              # /users endpoints
│  │  └─ notes.routes.ts              # /notes endpoints
│  ├─ services/
│  │  ├─ auth.service.ts              # Auth logic
│  │  ├─ users.service.ts             # User logic (vulnerable + secure)
│  │  └─ notes.service.ts             # Notes logic (vulnerable + secure)
│  └─ schemas/
│     ├─ auth.schema.ts               # Zod validation schemas
│     ├─ user.schema.ts
│     └─ note.schema.ts
├─ prisma/
│  ├─ schema.prisma                   # Database schema
│  ├─ seed.ts                         # Database seed
│  └─ dev.db                          # SQLite database (gitignored)
├─ tests/
│  ├─ auth.test.ts                    # Auth tests (both modes)
│  ├─ vulnerable.test.ts              # Vulnerability proofs
│  └─ secure.test.ts                  # Secure fixes validation
└─ docs/
   ├─ architecture.md                 # System design & LAB_MODE
   ├─ vulnerabilities.md              # Per-vulnerability deep dive
   └─ lab-guide.md                    # Step-by-step walkthrough
```

---

## Environment Variables

Rename `.env.example` to `.env` and customize if needed:

| Variable         | Default         | Purpose                                |
| ---------------- | --------------- | -------------------------------------- |
| `DATABASE_URL`   | `file:./dev.db` | SQLite database location               |
| `JWT_SECRET`     | (from .env)     | Secret for signing JWTs (≥32 chars)    |
| `JWT_EXPIRES_IN` | `1h`            | JWT expiry time                        |
| `BCRYPT_COST`    | `12`            | bcrypt work factor (4–15)              |
| `LAB_MODE`       | `secure`        | `vulnerable` or `secure`               |
| `PORT`           | `3000`          | HTTP port                              |
| `HOST`           | `127.0.0.1`     | Bind address (localhost only)          |
| `NODE_ENV`       | `development`   | `development`, `test`, or `production` |

---

## Branch Strategy

Three branches are maintained:

- **`main`** — Complete lab with both implementations and the `LAB_MODE` selector. This is the recommended branch to clone.
- **`vulnerable`** — Stripped down to the vulnerable code paths only, for isolated demonstration.
- **`secure`** — Stripped down to the secure code paths only, for comparison.

Switch branches to see only the implementation you need:

```bash
git switch vulnerable   # Vulnerable paths only
git switch secure       # Secure paths only
git switch main         # Both (default)
```

Run `git diff vulnerable secure -- src/services src/schemas` to see exactly what changes
between the two implementations: three files, 37 insertions and 7 deletions.

The wider `git diff vulnerable secure -- src/` also shows `config/env.ts` and `server.ts`,
because the production-mode refusal and the startup warning banner only exist on the
vulnerable branch. That difference is deliberate — the safety scaffolding belongs to the
insecure build, not to the fixed one.

---

## Learning Objectives

After completing this lab, you should understand:

1. **Authorization ≠ Authentication** — Just because a user is logged in doesn't mean they can access every resource.
2. **Ownership checks are mandatory** — Every resource endpoint must verify the caller owns the resource.
3. **Client input is not a security boundary** — The frontend never renders a `role` field, but the API must reject it anyway.
4. **Data exposure is real risk** — Hashed passwords can be cracked offline; leaked tokens are account-takeover vectors.
5. **Response shaping is a security decision** — Explicit DTOs and database `select` statements prevent accidental leaks.

---

## What This Lab Doesn't Cover

This lab focuses on three vulnerabilities and omits:

- **SQL injection** — Prisma parameterizes queries
- **JWT key confusion** — The secure implementation pins `HS256`
- **Weak password hashing** — bcrypt is correct in both modes
- **Refresh tokens** — Out of scope for a focused lab
- **Rate limiting** — A known simplification
- **CORS misconfiguration** — Not a focus

A future video series will cover JWT-specific flaws in depth.

---

## References

- **OWASP API Security Top 10 (2023)**
  - [API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0x01-index/)
  - [API3:2023 — Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0x01-index/)

- **Prisma Documentation**
  - [Query operations](https://www.prisma.io/docs/concepts/components/prisma-client)

- **Zod Documentation**
  - [Validation schemas](https://zod.dev)

---

## Contributing

This is an educational repository. Issues and pull requests are welcome for:

- Documentation clarity
- Test coverage improvements
- Code style consistency
- Typo fixes

Do not open issues to request additional vulnerabilities or changes to the three core ones — the lab is intentionally scoped.

---

## License

MIT

---

## YouTube Series

This lab is the teaching artifact for **Cybersecurity for Developers**, a video series on building secure applications.

- [YouTube playlist](https://youtube.com/playlist) (placeholder)

---

## Support

- **Installation issues** — Check [.env.example](.env.example) and ensure Node.js 20+ is installed.
- **API questions** — See [docs/lab-guide.md](docs/lab-guide.md) for curl examples.
- **Vulnerability details** — Read [docs/vulnerabilities.md](docs/vulnerabilities.md).
- **Architecture** — See [docs/architecture.md](docs/architecture.md).
- **Security issues** — See [SECURITY.md](SECURITY.md).

---

**Last updated:** 2024 | [View on GitHub](#)
