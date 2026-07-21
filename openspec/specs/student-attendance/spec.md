# student-attendance Specification

## Purpose
TBD - created by archiving change fix-attendance-routes. Update Purpose after archive.
## Requirements
### Requirement: Register manual attendance
The system SHALL allow an authenticated admin/instructora/recepción user to register a walk-in attendance record for an existing student, identified by `documento`, for a given date and optional time slot.

#### Scenario: Successful registration
- **WHEN** an authenticated admin user sends `POST /api/asistencia` with a `documento` that belongs to an existing student in the current tenant, and no attendance record exists yet for that student on that date
- **THEN** the system creates a row in `attendance` and responds `200` with `{ok: true, nombre, fecha}`

#### Scenario: Duplicate same-day registration rejected
- **WHEN** a student already has an attendance record for the given date and another registration is attempted for the same student and date
- **THEN** the system responds `409` with an error indicating the student already has attendance registered that day

#### Scenario: Unknown student rejected
- **WHEN** the `documento` sent does not match any student in the current tenant's database
- **THEN** the system responds `404` with an error indicating the student was not found

### Requirement: View today's registered attendances
The system SHALL allow an authenticated admin/instructora/recepción user to retrieve all attendance records for a given date (defaulting to today), grouped by time slot in the client.

#### Scenario: Attendances exist for the day
- **WHEN** an authenticated admin user sends `GET /api/asistencia/hoy`
- **THEN** the system responds `200` with a list of attendance records for the current date, each including `documento`, `horario`, and the student's `nombre`

#### Scenario: No attendances yet
- **WHEN** no attendance has been registered for the queried date
- **THEN** the system responds `200` with an empty array, not an error

### Requirement: View a student's attendance history
The system SHALL allow an authenticated admin/instructora/recepción user to retrieve the manual attendance history (from the `attendance` table) of a single student, identified by `documento`.

#### Scenario: Student has attendance history
- **WHEN** an authenticated admin user sends `GET /api/asistencia/alumno/:documento` for a student with existing `attendance` records
- **THEN** the system responds `200` with up to 100 records ordered by date descending, each including `id`, `fecha`, and `horario`

#### Scenario: Student has no attendance history
- **WHEN** the student has no records in `attendance`
- **THEN** the system responds `200` with an empty array, not an error

### Requirement: Toggle student active/inactive status
The system SHALL allow an authenticated admin/instructora/recepción user to set a student's `activo` flag directly, without requiring the full student record to be resubmitted.

#### Scenario: Successful toggle
- **WHEN** an authenticated admin user sends `PATCH /api/students/:documento/activo` with `{activo: 0}` or `{activo: 1}` for an existing student
- **THEN** the system updates the student's `activo` column accordingly and responds `200` with `{ok: true}`

#### Scenario: Unknown student
- **WHEN** the `documento` in the path does not match any student in the current tenant's database
- **THEN** the system responds `404` with an error indicating the student was not found

### Requirement: Tenant isolation
All attendance and student-status operations SHALL operate exclusively against the requesting admin's own tenant database, resolved from the verified JWT (`req.db`), never from a tenant identifier supplied by the client.

#### Scenario: Cross-tenant access is not possible
- **WHEN** an authenticated admin from studio A calls any of the above endpoints
- **THEN** the system can only read or write students/attendance rows in studio A's database, regardless of any `documento` value supplied — a `documento` belonging only to studio B simply returns "not found," never studio B's data

