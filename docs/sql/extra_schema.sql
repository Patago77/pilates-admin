-- Tablas que faltaban en el onboarding — encontradas comparando contra la
-- estructura real de pilates_admin_db (2026-08-26). Ninguna de estas vivía
-- en studio_schema.sql ni en agenda_schema.sql, así que un estudio nuevo
-- fallaba en asistencias, feriados, notificaciones, pagos pendientes y planes.

CREATE TABLE IF NOT EXISTS attendance (
  id INT NOT NULL AUTO_INCREMENT,
  documento VARCHAR(30) NOT NULL,
  fecha DATE NOT NULL,
  horario VARCHAR(10) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asistencia (documento, fecha),
  KEY idx_documento (documento),
  KEY idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feriados (
  fecha DATE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  habilitado TINYINT(1) DEFAULT 0,
  horas TEXT DEFAULT NULL COMMENT 'JSON array de horas habilitadas, null = todas',
  tipo ENUM('feriado','cierre') DEFAULT 'feriado',
  motivo VARCHAR(150) DEFAULT NULL,
  PRIMARY KEY (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificaciones (
  id INT NOT NULL AUTO_INCREMENT,
  titulo VARCHAR(120) NOT NULL,
  mensaje TEXT NOT NULL,
  tipo ENUM('info','fija','aviso','urgente') DEFAULT 'info',
  para ENUM('todos','individual','conAbono','sinPago','inactivos') DEFAULT 'todos',
  documento_destino VARCHAR(30) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_para (para)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificaciones_leidas (
  id INT NOT NULL AUTO_INCREMENT,
  notificacion_id INT NOT NULL,
  documento VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_leida (notificacion_id, documento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pagos_pendientes (
  id INT NOT NULL AUTO_INCREMENT,
  documento VARCHAR(30) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  plan VARCHAR(50) NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  estado ENUM('pendiente','procesando','confirmado','rechazado') DEFAULT 'pendiente',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_estado (estado),
  KEY idx_documento (documento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planes_config (
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  clases INT NOT NULL DEFAULT 0,
  precio DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
