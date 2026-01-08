-- Studio DB (por cliente)
CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  documento VARCHAR(40) NOT NULL UNIQUE,
  email VARCHAR(190) NULL,
  telefono VARCHAR(60) NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fullName VARCHAR(160) NOT NULL,
  documento VARCHAR(40) NULL,
  subscriptionType VARCHAR(80) NOT NULL,
  paymentDate DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payments_date (paymentDate),
  INDEX idx_payments_name (fullName),
  INDEX idx_payments_doc (documento)
);

CREATE TABLE IF NOT EXISTS gastos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoria VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  fecha DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gastos_fecha (fecha),
  INDEX idx_gastos_categoria (categoria)
);
