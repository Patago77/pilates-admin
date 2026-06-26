-- Agregar fecha_nacimiento a students (ejecutar una sola vez)
ALTER TABLE students ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE NULL;

-- Plan habitual del alumno (independiente del pago mensual)
ALTER TABLE students ADD COLUMN IF NOT EXISTS plan_actual VARCHAR(50) NULL;

-- Tokens OTP para login de alumnos en el portal
CREATE TABLE IF NOT EXISTS student_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  documento   VARCHAR(30)  NOT NULL,
  otp         VARCHAR(6)   NOT NULL,
  expires_at  DATETIME     NOT NULL,
  used        TINYINT(1)   DEFAULT 0,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_documento (documento),
  INDEX idx_otp (otp)
);

-- Reservas de agenda
CREATE TABLE IF NOT EXISTS agenda_reservas (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  fecha           DATE        NOT NULL,
  hora            VARCHAR(5)  NOT NULL,
  documento       VARCHAR(30) NOT NULL,
  estado          ENUM('confirmado','cancelado') DEFAULT 'confirmado',
  cancelado_en    TIMESTAMP   NULL,
  clase_devuelta  TINYINT(1)  DEFAULT 0,
  motivo_consumo  VARCHAR(50) NULL,
  created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reserva (fecha, hora, documento),
  INDEX idx_fecha (fecha),
  INDEX idx_documento (documento)
);

-- Clases prorateadas o asignadas manualmente para un pago puntual
-- ALTER TABLE payments ADD COLUMN clases_asignadas INT NULL AFTER serviceMonth;

-- Solicitudes de clases adicionales iniciadas por la alumna desde el portal
CREATE TABLE IF NOT EXISTS solicitudes_clases (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  documento     VARCHAR(30)  NOT NULL,
  mes           VARCHAR(7)   NOT NULL,
  cantidad      INT          NOT NULL DEFAULT 1,
  nota_alumna   TEXT         NULL,
  estado        ENUM('pendiente','aprobada','rechazada') DEFAULT 'pendiente',
  aprobado_por  VARCHAR(100) NULL,
  aprobado_en   TIMESTAMP    NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_mes (documento, mes),
  INDEX idx_estado (estado)
);

-- Devoluciones manuales de clases por el admin
CREATE TABLE IF NOT EXISTS clases_extra (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  documento   VARCHAR(30)  NOT NULL,
  mes         VARCHAR(7)   NOT NULL,
  cantidad    INT          NOT NULL DEFAULT 1,
  motivo      VARCHAR(255) NULL,
  creado_por  VARCHAR(100) NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_documento_mes (documento, mes)
);

-- Configuración de horarios por día de semana (0=Lun, 4=Vie)
CREATE TABLE IF NOT EXISTS agenda_config (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  dia_semana  TINYINT NOT NULL,  -- 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie
  hora        VARCHAR(5) NOT NULL,
  activo      TINYINT(1) DEFAULT 1,
  capacidad   INT DEFAULT 5,
  UNIQUE KEY uk_dia_hora (dia_semana, hora)
);

-- Horarios por defecto Lun-Vie
INSERT IGNORE INTO agenda_config (dia_semana, hora, capacidad) VALUES
  (1,'09:00',5),(1,'10:00',5),(1,'11:00',5),(1,'12:00',5),(1,'13:00',5),
  (1,'17:00',5),(1,'18:00',5),(1,'19:00',5),(1,'20:00',5),
  (2,'09:00',5),(2,'10:00',5),(2,'11:00',5),(2,'12:00',5),(2,'13:00',5),
  (2,'17:00',5),(2,'18:00',5),(2,'19:00',5),(2,'20:00',5),
  (3,'09:00',5),(3,'10:00',5),(3,'11:00',5),(3,'12:00',5),(3,'13:00',5),
  (3,'17:00',5),(3,'18:00',5),(3,'19:00',5),(3,'20:00',5),
  (4,'09:00',5),(4,'10:00',5),(4,'11:00',5),(4,'12:00',5),(4,'13:00',5),
  (4,'17:00',5),(4,'18:00',5),(4,'19:00',5),(4,'20:00',5),
  (5,'09:00',5),(5,'10:00',5),(5,'11:00',5),(5,'12:00',5),(5,'13:00',5),
  (5,'17:00',5),(5,'18:00',5),(5,'19:00',5),(5,'20:00',5);
