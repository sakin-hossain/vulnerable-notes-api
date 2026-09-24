# Security Policy

## Educational Lab Only

This repository is an **intentionally vulnerable educational lab** designed to teach application security concepts. The three vulnerabilities documented here are **deliberately introduced** and core to the lab's purpose.

- Do not deploy this code to production.
- Do not expose the vulnerable build to a network or the public internet.
- Do not use this as a template for real applications.

---

## Known Vulnerabilities

The following vulnerabilities are **intentional and out of scope for security reports**:

### V1 — Broken Object Level Authorization (IDOR)

- **Affected route:** `GET /api/notes/:id` (vulnerable mode)
- **Details:** See [docs/vulnerabilities.md](docs/vulnerabilities.md#v1--broken-object-level-authorization-idor)
- **OWASP:** API1:2023

### V2 — Mass Assignment / Privilege Escalation

- **Affected route:** `PATCH /api/users/me` (vulnerable mode)
- **Details:** See [docs/vulnerabilities.md](docs/vulnerabilities.md#v2--mass-assignment--privilege-escalation)
- **OWASP:** API3:2023

### V3 — Excessive Data Exposure

- **Affected route:** `GET /api/users/me` (vulnerable mode)
- **Details:** See [docs/vulnerabilities.md](docs/vulnerabilities.md#v3--excessive-data-exposure)
- **OWASP:** API3:2023

---

## Reporting an Unintended Vulnerability

If you discover a vulnerability not listed above, please do not open a public issue. Instead:

1. **Do not** open a GitHub issue or publish the details.
2. Email [team@technext.it](mailto:team@technext.it) with:
   - A clear description of the vulnerability
   - Steps to reproduce it
   - The impact of the issue
   - Suggested fix (optional)

We will:

- Review your report promptly
- Verify the vulnerability
- Issue a fix and provide credit if you wish
- Keep the disclosure responsible and non-public until a patch is available

---

## Versioning and Support

This lab is a **teaching tool**, not a production library. There are no supported versions or security patch timelines.

- **Latest version:** Use the `main` branch.
- **No backporting:** Security fixes are applied only to the latest code.
- **No LTS:** All versions are for educational use only.

---

## Do Not Deploy to Production

**It is not safe to run this code as a real application.**

The vulnerable build explicitly:

- Disallows running with `NODE_ENV=production` + `LAB_MODE=vulnerable`
- Prints a large banner to stderr on startup
- Binds to `127.0.0.1` by default; under Docker the loopback `127.0.0.1:` publish prefix is what keeps it local

The secure build:

- Is still a simplified example, not a production-ready system
- Has no rate limiting, refresh tokens, or advanced features
- Uses SQLite (single-writer, not suitable for high concurrency)
- Is intended for education and demonstration only

---

## What This Lab Gets Right

To clarify what is **not vulnerable**:

- ✅ JWT authentication (HS256 pinned, proper expiry, secret from environment)
- ✅ Password hashing (bcrypt, not plaintext or weak algorithms)
- ✅ Login security (identical errors for unknown email and wrong password; note that registration and PATCH return 409 on duplicate email, a documented trade-off)
- ✅ Note ownership on note routes (list/update/delete enforced in both modes; in vulnerable mode V2 can still re-parent notes via nested relation writes)
- ✅ Validation (strict schemas, unknown fields rejected)
- ✅ Error handling (no stack traces leaked over HTTP)
- ✅ Server binding (defaults to `127.0.0.1`; under Docker, safety comes from the loopback publish prefix)

---

## Scope of the Lab

This lab covers three specific vulnerabilities as examples of common mistakes:

- **Authorization failures:** Mistaking authentication for authorization
- **Input validation failures:** Casting request bodies without whitelisting
- **Data exposure:** Returning ORM objects without shaping responses

It does **not** deliberately demonstrate:

- SQL injection
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Weak JWT algorithm negotiation
- Plaintext or weak password storage
- CORS misconfiguration

If you discover any of these issues, they are bugs — report them as unintended vulnerabilities.

---

## License

MIT. See [LICENSE](LICENSE) for details.

---

## Questions

For questions about the lab's design, vulnerabilities, or intended use, open a GitHub discussion or issue (not a security report).

For unintended security issues, email [team@technext.it](mailto:team@technext.it).
