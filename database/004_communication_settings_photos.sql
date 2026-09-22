USE barber_team_machine;

ALTER TABLE barbers ADD COLUMN photo_url VARCHAR(2048) NULL AFTER bio;

CREATE TABLE business_settings (
  id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  business_name VARCHAR(160) NOT NULL,
  address VARCHAR(255) NOT NULL,
  city VARCHAR(120) NOT NULL,
  country VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  whatsapp VARCHAR(30) NOT NULL,
  hours_text VARCHAR(255) NOT NULL,
  maps_url VARCHAR(2048),
  instagram_url VARCHAR(2048),
  facebook_url VARCHAR(2048),
  description TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_business_settings_singleton CHECK (id = 1)
);

INSERT INTO business_settings (id, business_name, address, city, country, phone, whatsapp, hours_text, maps_url, instagram_url, facebook_url, description)
VALUES (1, 'Barber Team Machine', 'Buenos Aires 130', 'Cochabamba', 'Bolivia', '77469963', '77469963', 'Lunes a sábado · 10:00 AM — 7:00 PM · Domingo cerrado', 'https://maps.app.goo.gl/At4qrWe6P2KrDCyW9', NULL, NULL, 'Precisión, técnica y estilo para cada visita.')
ON DUPLICATE KEY UPDATE business_name = VALUES(business_name);

CREATE TABLE reminder_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('EMAIL', 'IN_APP', 'WHATSAPP') NOT NULL,
  reminder_type ENUM('24H', '2H') NOT NULL,
  scheduled_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  status ENUM('PENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(1000),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reminder_jobs_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  CONSTRAINT uq_reminder_jobs_unique_delivery UNIQUE (appointment_id, channel, reminder_type),
  INDEX idx_reminder_jobs_pending (status, scheduled_at)
);
