-- Solicitudes de alta de estudios nuevos (ejecutar una sola vez, contra pilates_core_db)
-- El alta real de un estudio (crear su base, su admin, etc.) NUNCA pasa por acá directo:
-- esto solo registra el pedido. La aprobación es un paso manual aparte (Fase B).
CREATE TABLE IF NOT EXISTS solicitudes_estudio (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  nombre_estudio VARCHAR(120) NOT NULL,
  email_contacto VARCHAR(190) NOT NULL,
  telefono       VARCHAR(40)  NULL,
  estado         ENUM('pendiente','aprobado','rechazado','error') DEFAULT 'pendiente',
  notas_admin    TEXT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resuelto_en    TIMESTAMP NULL,
  INDEX idx_estado (estado)
);
