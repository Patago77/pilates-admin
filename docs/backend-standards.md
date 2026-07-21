---
description: Backend development standards for pilates-admin (StudioAdmin) — Express + mysql2 (no ORM), multi-tenant architecture, and the two distinct auth systems
globs: ["routes/**/*.js", "*.js", "*.env*"]
alwaysApply: true
---

# Backend Standards — pilates-admin (StudioAdmin)

## Overview

Plain Node.js + Express 4 backend, no TypeScript, no ORM. Queries go straight through `mysql2/promise` with parameterized placeholders (`?`). This is **not** a DDD/layered-architecture project — routes talk to the database directly. Keep that simplicity; do not introduce a repository/service/domain layering that doesn't exist here.

## Technology Stack

- **Express 4** — one router file per resource area under `routes/`, mounted in `server.js` under `/api`.
- **mysql2/promise** — connection pools per database, no query builder, no ORM. See `db.js`.
- **jsonwebtoken + bcrypt/bcryptjs** — two separate JWT systems (see below).
- **express-validator** — used only on `/api/login` today; most routes validate manually with `if (!field) return res.status(400)...`.
- **helmet, express-rate-limit, cookie-parser** — security middleware in `server.js`.
- **multer** (memory storage) — CSV upload for `routes/importar.js`.
- **pdfkit** — PDF receipt generation (`routes/recibo.js`).
- **node-cron / nodemailer** — scheduled reminders (`recordatorio.js`) and transactional email (`emailService.js`).

## Architecture: Multi-Tenant by Database

- **Core DB** (`CORE_DB_NAME` in `.env`): `studios` and `users` tables only. One row per client studio, one row per admin/instructora/recepción user.
- **Studio DB** (one per client, `studio_<slug>_db`): every operational table — `students`, `payments`, `agenda_reservas`, `attendance`, etc. See `docs/data-model.md` for the full table list (note the drift warnings documented there).
- `db.js` exposes `getCorePool()` and `getStudioPool(dbName)`, each returning a cached connection pool (`Map` keyed by DB name).

### The multi-tenant isolation rule (non-negotiable)

**A studio's data must never be reachable using a `studio_id`/`studio_db` value supplied by the client.** The tenant is always derived from a verified JWT:

- Admin routes: `authenticateToken` (in `authMiddleware.js`) decodes the `admin_token` cookie, then calls `getStudioPool(user.studio_db)` and attaches it as `req.db`. Every subsequent query in that request uses `req.db` — never a hardcoded DB name, never a DB name read from `req.body`/`req.query`.
- Alumna routes: the local `authAlumno` middleware (defined per-file, e.g. in `routes/agenda.js`) decodes the alumna's own JWT and does the same with `req.alumno.studio_db`.

Before considering any change to a route that touches the DB "done", run **`/review-tenant`** (existing project command, `.claude/commands/review-tenant.md`) — it specifically checks for: queries not using the tenant pool, `studio_id`/`documento` trusted from the request body instead of the JWT, and joins missing the tenant filter on every table. Use `/fix-tenant` to apply the fixes it reports.

## Two Auth Systems — Do Not Mix Them

| | Admin / instructora panel | Alumna portal |
|---|---|---|
| Login | `POST /api/login` (email+password) | `POST /api/alumno/solicitar-otp` + `verificar-otp` (documento + email OTP) |
| Token transport | httpOnly cookie `admin_token` | `Authorization: Bearer <token>` or `?token=` |
| Middleware | `authenticateToken` (+ `requireAdmin` when role must be `admin`, not `recepcion`) from `authMiddleware.js` | `authAlumno`, a **separate, locally-defined** middleware inside the route file that needs it |
| Token payload | `{ id, email, role, studio_id, studio_db }` | `{ documento, nombre, email, studio_db, rol: 'alumno' }` |

A token from one system will not authenticate against the other's middleware. When adding a new alumna-facing route, use `authAlumno`, not `authenticateToken`.

## Route File Conventions

- One router per resource area (`payments.js`, `students.js`, `agenda.js`, ...), `module.exports = router`, mounted with `app.use('/api', xRouter)` in `server.js`.
- Route naming mixes English resources (`/payments`, `/students`, `/gastos`) with Spanish action paths (`/asistencia/hoy`, `/admin/agenda/agregar`) — this reflects real history, not a rule to enforce going forward; match whichever convention the sibling routes in that file already use.
- Standard handler shape:
  ```js
  router.get('/resource/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const [rows] = await req.db.query(`SELECT ... WHERE id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Mensaje en español." });
      res.json(rows[0]);
    } catch (err) {
      console.error("❌ Error <contexto>:", err.message);
      res.status(500).json({ error: "Mensaje en español." });
    }
  });
  ```
- Errors always: `console.error('❌ ...', err.message)` server-side, `res.status(NNN).json({ error: "..." })` (Spanish) to the client. Don't leak `err.message`/stack traces in the response body.
- Use `requireAdmin` when an action must be restricted to `role === 'admin'` (e.g. deleting a payment, cancelling a whole slot); omit it when `recepcion` should also have access (e.g. registering a student, taking attendance).

## Self-Healing Tables Pattern

Some tables (`studio_config`, `feriados`) are created lazily via `CREATE TABLE IF NOT EXISTS` inside an `ensureXTable(db)` helper, called at the top of the routes that use them, memoized with a `WeakSet` so it only runs once per pool. This is how `create_client.sh` gets away with not provisioning every table upfront (see `docs/data-model.md` for which tables this does **not** cover, and the known bug in that script). Follow this pattern only for genuinely optional/config-style tables — core business tables (`students`, `payments`, etc.) must be part of the studio provisioning schema, not lazily created.

## Transactions

Use `req.db.getConnection()` + `beginTransaction()`/`commit()`/`rollback()`/`release()` for any multi-statement change that must be atomic — see `students.js` (`cambiar-documento`, cascades across 5 tables) and `agenda.js` (`agenda/reservar`, cupo-checking with `FOR UPDATE` locks) for the canonical pattern. Always `release()` in a `finally` block.

## Validation

Most routes validate manually at the top of the handler (`if (!nombre || !documento) return res.status(400)...`). `express-validator` is only wired into `/api/login`. Don't introduce a new validation library for a single route — match the manual-check convention unless the whole file already uses `express-validator`.

## Testing (see also `docs/base-standards.md` §7)

There is no automated test suite. Every change to a route must be verified with `curl` against the local server before being considered done — success case and at least one failure case (validation, 404, or auth). Document the exact `curl` commands used if the change is part of an OpenSpec `tasks.md` (once adopted).

## Known Drift — Read Before Trusting Anything Blindly

`docs/data-model.md` documents confirmed inconsistencies between what's written in `docs/sql/*.sql`, what `create_client.sh` does, and what the real production schema (`pilates_core_db` / `pilates_admin_db` on the Hostinger VPS) actually has. Don't assume a `.sql` file is authoritative — verify against `req.db`/production before changing schema-dependent code.
