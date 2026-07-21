# Data Model — pilates-admin (StudioAdmin)

> Generado leyendo el código real (`routes/*.js`, `docs/sql/*.sql`, `db.js`, `create_client.sh`) el 2026-07-21. No se pudo conectar a una base de datos viva para confirmar con `SHOW CREATE TABLE` (no había MySQL corriendo en local en el momento de generarlo) — donde no hay un `CREATE TABLE` confirmado en el repo, la tabla está marcada como **[inferida]** a partir de las queries que la usan. Antes de confiar en una tabla inferida para un cambio importante, conviene confirmarla contra la base real (dev o prod).

## ⚠️ Inconsistencias detectadas (documentar ≠ arreglar — esto quedó solo como hallazgo)

1. **`studios` y `users` (core DB)**: `docs/sql/core_schema.sql` define `studios.name` (sin `slug`) y `users` sin columna `nombre`. Pero `create_client.sh` — el script real que da de alta clientes — inserta usando `nombre` y `slug`. El `.sql` documentado no coincide con lo que el sistema realmente usa.
2. **`students`**: `docs/sql/studio_schema.sql` define la columna `fullName`. El código real (`students.js`, `dashboard.js`, `agenda.js`, etc.) consulta `s.nombre` y `s.telefono` — columnas que no están en ese archivo `.sql`. La tabla real fue modificada sin actualizar el schema documentado.
3. **`create_client.sh` deja bases de clientes nuevos incompletas**: solo ejecuta `studio_schema.sql` (`students`, `payments`, `gastos`). No crea `agenda_reservas`, `attendance`, `planes_config`, `pagos_pendientes`, `notificaciones`, `notificaciones_leidas`, `student_tokens`, `solicitudes_clases`, `clases_extra`. De esas, `studio_config` y `feriados` se auto-crean solas la primera vez que se usan (tienen `ensure...Table()` en el código); el resto, no — un cliente nuevo daría error al usar agenda, asistencia o pagos pendientes hasta que alguien cree esas tablas a mano.
4. **Posible bug menor en `/api/login`** (`server.js`): el `SELECT` no trae `u.nombre`, pero la respuesta arma `user: { nombre: user.nombre, ... }` — probablemente devuelve `nombre: undefined`.

---

## Arquitectura: multi-tenant por base de datos

- **Core DB** (`CORE_DB_NAME` en `.env`, dev: `estudio_pilates_dev`): una sola base compartida con `studios` y `users`.
- **Studio DB** (una por cliente, `studio_<slug>_db`): todas las tablas operativas del estudio (alumnas, pagos, agenda, etc.), completamente aisladas entre clientes.
- El login resuelve `studio_db` a partir del email en `core_db`, y a partir de ahí `getStudioPool(dbName)` (`db.js`) abre el pool correcto. El aislamiento entre tenants depende de que **todas** las queries usen ese pool (`req.db`) y nunca un `studio_id`/`documento` que venga directo del cliente — ver `.claude/commands/review-tenant.md`, que ya audita esto.

---

## Core DB

### `studios`
| Columna | Tipo (según uso real) | Notas |
|---|---|---|
| id | INT PK | |
| nombre | VARCHAR | doc viejo dice `name` |
| slug | VARCHAR | usado como parte de `db_name`, no está en `docs/sql/core_schema.sql` |
| db_name | VARCHAR UNIQUE | nombre de la base MySQL del estudio |
| active | TINYINT(1) | |
| created_at | TIMESTAMP | |

### `users`
Admins/instructoras que loguean en el panel (`/api/login`).

| Columna | Tipo | Notas |
|---|---|---|
| id | INT PK | |
| email | VARCHAR UNIQUE | |
| password_hash | VARCHAR | bcrypt |
| nombre | VARCHAR | no está en `docs/sql/core_schema.sql`, sí se inserta en `create_client.sh` |
| role | VARCHAR | ej. `admin` |
| studio_id | INT FK → studios.id | |
| active | TINYINT(1) | |
| created_at | TIMESTAMP | |

---

## Studio DB (`studio_<slug>_db`)

### Alumnas

#### `students`
| Columna | Tipo | Notas |
|---|---|---|
| id | INT PK | |
| documento | VARCHAR, indexada | identificador principal usado en casi todas las demás tablas (no `id`) |
| nombre | VARCHAR | `docs/sql` dice `fullName` — desactualizado |
| telefono | VARCHAR | no documentado en `docs/sql` |
| email | VARCHAR | |
| fecha_nacimiento | DATE | agregada por `docs/sql/agenda_schema.sql` |
| plan_actual | VARCHAR | agregada por `docs/sql/agenda_schema.sql`, referencia `planes_config.codigo` |
| activo | TINYINT(1) | soft delete — `DELETE /students/:documento` solo pone `activo=0`, no borra la fila. No está en ningún `docs/sql`, confirmado leyendo `routes/students.js` y `routes/stats.js` |
| creado_en | TIMESTAMP | |

### Pagos y planes

#### `payments`
| Columna | Tipo | Notas |
|---|---|---|
| id | INT PK | |
| fullName | VARCHAR | nombre del alumno en el momento del pago (copia, no FK) |
| documento | VARCHAR, indexada | |
| subscriptionType | VARCHAR | referencia `planes_config.codigo` |
| amount | DECIMAL(10,2) | |
| paymentDate | DATE, indexada | |
| serviceMonth | VARCHAR(7), indexada | `YYYY-MM` |
| metodoPago | VARCHAR | |
| estadoDeuda | ENUM('al_dia','debe','le_debemos') | default `al_dia` |
| comentarios | TEXT | |
| clases_asignadas | INT | prorrateo manual de clases (ver `agenda.js`) |
| creado_en | TIMESTAMP | |

#### `planes_config` [inferida]
| Columna | Notas |
|---|---|
| codigo | clave única, referenciada por `payments.subscriptionType` y `students.plan_actual` |
| nombre | |
| clases | cantidad de clases del plan |
| precio | |

#### `pagos_pendientes` [inferida]
Pagos que la alumna reporta desde el portal, a confirmar por un admin.

| Columna | Notas |
|---|---|
| id | PK |
| documento | |
| nombre | |
| plan | |
| monto | |
| estado | `pendiente` → `procesando` (lock atómico) → `confirmado` / `rechazado` |
| created_at | |

#### `gastos`
| Columna | Tipo | Notas |
|---|---|---|
| id | INT PK | |
| fecha | DATE, indexada | |
| categoria | VARCHAR(80), indexada | |
| descripcion | VARCHAR(255) | |
| monto | DECIMAL(10,2) | |
| creado_en | TIMESTAMP | |

### Agenda y asistencia

#### `agenda_reservas`
Reservas de clase hechas por la alumna desde el portal.

| Columna | Tipo | Notas |
|---|---|---|
| id | INT PK | |
| fecha | DATE, indexada | |
| hora | VARCHAR(5) | |
| documento | VARCHAR, indexada | |
| estado | ENUM('confirmado','cancelado') | |
| cancelado_en | TIMESTAMP | |
| clase_devuelta | TINYINT(1) | si la cancelación devolvió el crédito de clase |
| motivo_consumo | VARCHAR(50) | |
| created_at | TIMESTAMP | |
| UNIQUE | (fecha, hora, documento) | |

#### `agenda_config`
Definida en `docs/sql/agenda_schema.sql` (horarios por día de semana + capacidad). No se encontraron queries activas contra esta tabla en `routes/` — es posible que haya sido reemplazada por `studio_config` (clave `agenda_horario_semana`) y haya quedado en desuso. Confirmar antes de asumir que se usa.

#### `feriados`
Feriados y cierres del estudio.

| Columna | Notas |
|---|---|
| fecha | PK |
| nombre | |
| habilitado | TINYINT(1), default 0 |
| tipo | `feriado` / `cierre` — usado en queries pero **no** está en el `CREATE TABLE IF NOT EXISTS` embebido en `agenda.js` (línea ~902) |
| motivo | ídem, usado pero no en el `CREATE TABLE` embebido |
| horas | JSON con horas habilitadas ese día; ídem |

Nota: como el `CREATE TABLE IF NOT EXISTS` en código está incompleto respecto a lo que las queries usan, esto solo funciona porque la tabla real en producción ya tiene esas columnas agregadas a mano — si algún día se recrea la tabla desde ese `CREATE TABLE` embebido, va a fallar.

#### `attendance` [inferida]
Asistencias físicas al estudio (distinto de `agenda_reservas`, que es la reserva online).

| Columna | Notas |
|---|---|
| id | PK |
| documento | |
| fecha | |
| horario | |

#### `solicitudes_clases`
Pedidos de clases extra hechos por la alumna.

| Columna | Tipo |
|---|---|
| id | INT PK |
| documento | VARCHAR(30) |
| mes | VARCHAR(7) |
| cantidad | INT, default 1 |
| nota_alumna | TEXT |
| estado | ENUM('pendiente','aprobada','rechazada') |
| aprobado_por | VARCHAR(100) |
| aprobado_en | TIMESTAMP |
| created_at | TIMESTAMP |

#### `clases_extra`
Devoluciones/asignaciones manuales de clases hechas por el admin.

| Columna | Tipo |
|---|---|
| id | INT PK |
| documento | VARCHAR(30) |
| mes | VARCHAR(7) |
| cantidad | INT, default 1 |
| motivo | VARCHAR(255) |
| creado_por | VARCHAR(100) |
| created_at | TIMESTAMP |

### Portal de alumna — autenticación

#### `student_tokens`
OTP de 6 dígitos para el login de alumnas (sin contraseña).

| Columna | Tipo |
|---|---|
| id | INT PK |
| documento | VARCHAR(30), indexada |
| otp | VARCHAR(6), indexada |
| expires_at | DATETIME |
| used | TINYINT(1) |
| created_at | TIMESTAMP |

### Configuración

#### `studio_config`
Key-value genérico para configuración del estudio (horarios de reformer, datos de pago CBU/alias, horario semanal de agenda). Se auto-crea en el primer uso.

| Columna | Notas |
|---|---|
| clave | PK. Prefijos usados: `rf_*` (reformers/config del panel de salud), `pago_*` (CBU/alias/titular), `agenda_horario_semana` |
| valor | TEXT, JSON o string plano según la clave |
| updated_at | auto-update |

### Notificaciones

#### `notificaciones` [inferida]
| Columna | Notas |
|---|---|
| id | PK |
| titulo | |
| mensaje | |
| tipo | ej. `fija`, `info` — `fija` no se marca como leída |
| para | `todos` / `individual` / `conAbono` |
| documento_destino | usado cuando `para = 'individual'` |
| created_at | |

#### `notificaciones_leidas` [inferida]
| Columna | Notas |
|---|---|
| notificacion_id | FK → notificaciones.id |
| documento | quién la leyó |

---

## Próximo paso sugerido
Confirmar las tablas marcadas **[inferida]** y la de `feriados` contra la base real (dev o prod) con `SHOW CREATE TABLE <tabla>` antes de usarlas como referencia para un cambio de schema. También conviene decidir qué hacer con el hallazgo de `create_client.sh` (bases de clientes nuevos incompletas) como su propio cambio, no mezclado con esta documentación.
