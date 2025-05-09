-- Tabla de roles de WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  description TEXT,
  max_daily_messages INT NOT NULL DEFAULT 10,
  max_monthly_messages INT,
  valid_until_days INT, -- Días desde la creación hasta expiración
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de usuarios de WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100),
  email VARCHAR(100),
  role_id INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  daily_message_count INT DEFAULT 0,
  monthly_message_count INT DEFAULT 0,
  last_message_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  valid_until DATE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES whatsapp_roles(id)
);

-- Tabla de consumo de mensajes (para estadísticas y auditoría)
CREATE TABLE IF NOT EXISTS whatsapp_message_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_user_id INT NOT NULL,
  message_date DATE NOT NULL,
  message_count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (whatsapp_user_id) REFERENCES whatsapp_users(id)
);

-- Insertar roles predeterminados
INSERT INTO whatsapp_roles (name, description, max_daily_messages, max_monthly_messages, valid_until_days)
VALUES 
  ('básico', 'Acceso limitado a 5 mensajes diarios, válido por 30 días', 5, 100, 30),
  ('estándar', 'Acceso a 20 mensajes diarios, válido por 90 días', 20, 500, 90),
  ('premium', 'Acceso ilimitado a mensajes diarios, válido por 365 días', 100, 3000, 365),
  ('admin', 'Acceso ilimitado sin restricciones de tiempo', NULL, NULL, NULL); 