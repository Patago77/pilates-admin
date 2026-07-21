## Why

The admin panel frontend (`public/script.js`, added 2026-05-24) calls `/attendance/*` and `/students/:documento/activo` routes. The backend's attendance handling was rebuilt on 2026-06-06 under a different path (`/asistencia/*`), and the frontend was never updated. As a result, four real, actively-used admin panel buttons have been silently broken for over a month: registering manual attendance (two entry points), viewing today's attendance, viewing a student's attendance history, and toggling a student active/inactive. One of the four (`cargarAsistenciasHoy()`) fails completely silently — only `console.error`, no user-facing indication.

## What Changes

- Add `PATCH /students/:documento/activo` to `routes/students.js` (toggle a student's active/inactive state; frontend already called this path, it just didn't exist yet).
- Add `GET /asistencia/alumno/:documento` to `routes/students.js` (per-student attendance history from the `attendance` table; no prior equivalent existed).
- Fix 3 frontend `fetch` calls in `public/script.js` (`registrarAsistenciaModal`, `registrarAsistencia`, `cargarAsistenciasHoy`) from `/attendance*` to the real `/asistencia*` paths.
- Update `docs/api-spec.yml` with the 2 new endpoints.

No database schema changes. No changes to the alumna-portal auth system or any alumna-facing route.

## Capabilities

### New Capabilities
- `student-attendance`: Manual attendance tracking for the admin panel — registering a walk-in attendance record, viewing today's registered attendances, viewing a single student's attendance history, and toggling a student's active/inactive status. This capability already existed in practice (partially working, partially broken) but has no spec yet; this change establishes its baseline spec as part of fixing it.

### Modified Capabilities
(none — no existing spec files exist yet in `openspec/specs/`)

## Impact

- `routes/students.js` — 2 new route handlers, additive only (no existing routes changed).
- `public/script.js` — 3 one-line URL corrections, no behavior change beyond making the calls actually reach a real endpoint.
- `docs/api-spec.yml` — 2 new path entries.
- No impact on the alumna portal, on `agenda_reservas`-based attendance (a separate, already-working mechanism), or on any other studio's data (single-tenant-safe: both new routes use `req.db`, scoped by the admin's JWT `studio_db` as usual).
