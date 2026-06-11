CREATE TABLE IF NOT EXISTS students (
  id INT NOT NULL AUTO_INCREMENT,
  fullName VARCHAR(120) NOT NULL,
  documento VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  creado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY (documento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT NOT NULL AUTO_INCREMENT,
  fullName VARCHAR(120) NOT NULL,
  documento VARCHAR(30) NULL,
  subscriptionType VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  paymentDate DATE NOT NULL,
  serviceMonth VARCHAR(7) DEFAULT NULL,
  metodoPago VARCHAR(30) DEFAULT NULL,
  estadoDeuda ENUM('al_dia','debe','le_debemos') DEFAULT 'al_dia',
  comentarios TEXT DEFAULT NULL,
  creado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY (documento),
  KEY (paymentDate),
  KEY (serviceMonth)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gastos (
  id INT NOT NULL AUTO_INCREMENT,
  fecha DATE NOT NULL,
  categoria VARCHAR(80) NOT NULL,
  descripcion VARCHAR(255) NULL,
  monto DECIMAL(10,2) NOT NULL,
  creado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY (fecha),
  KEY (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
