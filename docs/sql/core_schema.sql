-- Core DB: users + studios
CREATE TABLE IF NOT EXISTS studios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  db_name VARCHAR(120) NOT NULL UNIQUE,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'admin',
  studio_id INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_studio FOREIGN KEY (studio_id) REFERENCES studios(id)
);

-- Ejemplo:
-- INSERT INTO studios (name, db_name) VALUES ('Estudio Pilates Morón', 'studio_001_db');
-- INSERT INTO users (email, password_hash, role, studio_id) VALUES ('admin@example.com', '<bcrypt_hash>', 'admin', 1);
