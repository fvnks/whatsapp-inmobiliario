-- Create WhatsApp Roles table
CREATE TABLE IF NOT EXISTS `whatsapp_roles` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL,
  `description` VARCHAR(255),
  `max_daily_messages` INT DEFAULT NULL,
  `max_monthly_messages` INT DEFAULT NULL,
  `valid_until_days` INT DEFAULT 30,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create default roles
INSERT INTO `whatsapp_roles` 
  (`name`, `description`, `max_daily_messages`, `max_monthly_messages`, `valid_until_days`) 
VALUES 
  ('básico', 'Rol básico con funcionalidades limitadas', 10, 100, 30),
  ('estándar', 'Rol estándar con funcionalidades moderadas', 30, 300, 30),
  ('premium', 'Rol premium con funcionalidades completas', 100, 1000, 90),
  ('admin', 'Rol administrativo sin limitaciones', NULL, NULL, 365);

-- Ensure WhatsApp users table exists with proper structure
CREATE TABLE IF NOT EXISTS `whatsapp_users` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `phone_number` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100),
  `email` VARCHAR(100),
  `role_id` INT NOT NULL DEFAULT 1,
  `is_active` BOOLEAN DEFAULT TRUE,
  `valid_until` DATE,
  `daily_message_count` INT DEFAULT 0,
  `monthly_message_count` INT DEFAULT 0,
  `last_message_date` DATE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`role_id`) REFERENCES `whatsapp_roles`(`id`)
);

-- Create usage tracking table
CREATE TABLE IF NOT EXISTS `whatsapp_message_usage` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `whatsapp_user_id` INT NOT NULL,
  `message_date` DATE NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`whatsapp_user_id`) REFERENCES `whatsapp_users`(`id`)
); 