CREATE DATABASE IF NOT EXISTS barber_team_machine
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE barber_team_machine;

CREATE TABLE roles (
  id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE
);

INSERT INTO roles (name) VALUES ('CLIENTE'), ('ADMINISTRADOR');

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id TINYINT UNSIGNED NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  phone VARCHAR(30),
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
);

CREATE TABLE password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users (id),
  INDEX idx_password_reset_tokens_expiry (user_id, expires_at, used_at)
);

CREATE TABLE barbers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  bio TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_barbers_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE services (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_services_price CHECK (price >= 0),
  CONSTRAINT chk_services_duration CHECK (duration_minutes > 0)
);

CREATE TABLE barber_services (
  barber_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (barber_id, service_id),
  CONSTRAINT fk_barber_services_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT fk_barber_services_service FOREIGN KEY (service_id) REFERENCES services (id)
);

CREATE TABLE barber_working_hours (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  barber_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_working_hours_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT chk_working_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT chk_working_hours_range CHECK (start_time < end_time),
  UNIQUE (barber_id, weekday, start_time, end_time)
);

CREATE TABLE schedule_blocks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  barber_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_schedule_blocks_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT chk_schedule_blocks_range CHECK (starts_at < ends_at),
  INDEX idx_schedule_blocks_range (barber_id, starts_at, ends_at)
);

CREATE TABLE appointments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  barber_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
  cancellation_reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appointments_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT fk_appointments_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT fk_appointments_service FOREIGN KEY (service_id) REFERENCES services (id),
  CONSTRAINT chk_appointments_range CHECK (starts_at < ends_at),
  INDEX idx_appointments_barber_range (barber_id, starts_at, ends_at),
  INDEX idx_appointments_client_history (client_id, starts_at)
);

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  appointment_id BIGINT UNSIGNED NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_notifications_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  INDEX idx_notifications_user_status (user_id, read_at, created_at)
);
