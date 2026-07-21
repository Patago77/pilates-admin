## Context

`routes/students.js` already implements the real attendance mechanism under `/asistencia/*` (register, list today's, list by month, delete, mark/unmark absent). A separate, older mechanism (`agenda_reservas`-based attendance, used for reservation-based classes) is unrelated and untouched by this change. The frontend was written against an earlier, now-nonexistent `/attendance/*` API shape and never migrated when `/asistencia/*` replaced it.

## Goals / Non-Goals

**Goals:**
- Make the four broken admin-panel actions work again, using the existing `/asistencia/*` naming convention already established in `routes/students.js`.
- Add the two missing endpoints following the exact conventions already present in the file (error shape, auth middleware, response format).

**Non-Goals:**
- Not touching the `agenda_reservas`-based attendance flow (reservations/asistencia por turno) — that's a separate, already-working mechanism.
- Not renaming any existing `/asistencia/*` route to `/attendance/*` or vice versa — the Spanish naming is the established convention for this file, per `docs/backend-standards.md`.
- Not adding automated tests (none exist in this project) — verification is manual curl per `docs/openspec-tasks-mandatory-steps.md`.

## Decisions

1. **Add `PATCH /students/:documento/activo` rather than reusing `PUT /students/:documento`.** The existing `PUT` requires `nombre` in the body (full-record update) and would reject a bare `{activo}` payload the frontend already sends. A dedicated `PATCH` mirrors the existing `PATCH /users/:id/active` pattern in `routes/users.js` — same shape, same idiom, no need to change the frontend's payload.
2. **Add `GET /asistencia/alumno/:documento` reading from the `attendance` table, not `agenda_reservas`.** The frontend's `verAsistenciasAlumno()` expects `{fecha, horario}` records, which matches `attendance`'s shape (`documento, fecha, horario`) — `agenda_reservas` has a different shape (`estado`, `clase_devuelta`, etc.) used by a different UI flow (`students.js`'s existing `/students/:documento/cuenta` endpoint already surfaces `agenda_reservas`-based history separately).
3. **Fix the frontend by changing the URL, not by adding backend aliases for `/attendance/*`.** Keeping two paths for the same behavior would reintroduce exactly the kind of drift that caused this bug. One canonical path per capability.

## Risks / Trade-offs

- **[Risk] Local dev and production schemas have already been found to differ in other tables (see `docs/data-model.md`)** → Mitigation: this change only touches `students.activo` (confirmed to exist in both local and production via direct queries during Fase 1) and `attendance` (confirmed to exist and be populated in local dev with 929 rows; existing `/asistencia/hoy` and `POST /asistencia` already depend on this same table in production, so its existence there is already implied by current working functionality).
- **[Risk] No automated regression test exists to catch a future re-break of this same drift** → Mitigation: out of scope for this change (no test infra), but `docs/api-spec.yml` is now the authoritative reference frontend developers should check before adding a new `fetch` call — codified in `ai-specs/agents/frontend-developer.md`.

## Migration Plan

1. Apply backend + frontend changes locally.
2. Verify manually with curl against local MySQL (mandatory, no automated suite) — already done during Fase 1 exploration, to be re-confirmed formally in `tasks.md`.
3. Deploy: commit + push to GitHub, `git pull` on the VPS, restart the Node process. No DB migration needed (no schema change). **Deployment itself requires separate explicit user confirmation before being carried out** — not assumed as part of completing this OpenSpec change.

## Open Questions

- None blocking. Deployment timing to production is a decision for the user, not a technical open question.
