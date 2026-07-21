## 1. Backend implementation

- [x] 1.1 Add `PATCH /students/:documento/activo` in `routes/students.js`, following the `PATCH /users/:id/active` pattern from `routes/users.js`
- [x] 1.2 Add `GET /asistencia/alumno/:documento` in `routes/students.js`, reading from the `attendance` table

## 2. Frontend fix

- [x] 2.1 Fix `registrarAsistenciaModal()` in `public/script.js`: `/attendance` → `/asistencia`
- [x] 2.2 Fix `registrarAsistencia()` in `public/script.js`: `/attendance` → `/asistencia`
- [x] 2.3 Fix `cargarAsistenciasHoy()` in `public/script.js`: `/attendance/hoy` → `/asistencia/hoy`
- [x] 2.4 Fix `verAsistenciasAlumno()` in `public/script.js`: `/attendance/alumno/:documento` → `/asistencia/alumno/:documento`

## 3. Manual verification with curl (MANDATORY — no automated test suite exists)

- [x] 3.1 Start local server against local MySQL (`estudio_pilates_dev`)
- [x] 3.2 `PATCH /students/:documento/activo` — toggled a real student's `activo` 1→0, verified via `GET /students`, restored to 1
- [x] 3.3 `GET /asistencia/alumno/:documento` — confirmed real attendance history returned with the shape the frontend expects (`fecha`, `horario`)
- [x] 3.4 `GET /asistencia/hoy` — confirmed valid empty-array response when no attendance exists for today
- [x] 3.5 `POST /asistencia` — registered a real test attendance record, verified it in the DB, then deleted the test row to restore local state

## 4. Multi-tenant isolation check (MANDATORY — touches studio-DB queries)

- [x] 4.1 Ran the `/review-tenant` checklist manually against the real diff (`git diff -- routes/students.js public/script.js docs/api-spec.yml`). Result: **no findings**.
  - Queries without tenant pool: none — both new routes use `req.db.query(...)`, the pool set by `authenticateToken`.
  - Skipped middleware: none — both routes have `authenticateToken` in the chain.
  - Cross-tenant IDs from body/query: none — `documento` is a path param (student identifier within the already-scoped `req.db`), `activo` is a plain boolean, neither is a tenant selector.
  - Joins/subqueries missing tenant filter: none — both queries are single-table (`UPDATE students`, `SELECT ... FROM attendance`), no joins.
  - Shared/cached state: none introduced.
- [x] 4.2 Confirmed both new routes use `req.db` (never a client-supplied tenant identifier) — see 4.1.

## 5. Documentation

- [x] 5.1 Update `docs/api-spec.yml` with the 2 new endpoints (`PATCH /students/{documento}/activo`, `GET /asistencia/alumno/{documento}`), flagging that they were added to fix a live bug

## 6. Deployment (NOT part of this OpenSpec change's completion — separate explicit decision)

- [ ] 6.1 Commit the changes with a descriptive message
- [ ] 6.2 Push to GitHub
- [ ] 6.3 `git pull` on the VPS (`/root/pilates-admin`) and restart the Node process
- [ ] 6.4 Smoke-test the 4 fixed buttons against production after deploy

**Note**: Tasks 1–3 and 5 were completed during the exploratory session that found this bug (2026-07-21), before this formal OpenSpec change was retroactively created to document and verify the work per the adopted workflow (see `docs/base-standards.md` §8). Tasks 4 and 6 are genuinely still pending.
