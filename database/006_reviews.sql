USE barber_team_machine;

CREATE TABLE reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  appointment_id BIGINT UNSIGNED NULL,
  barber_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(1500) NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT fk_reviews_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  CONSTRAINT fk_reviews_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT uq_reviews_appointment UNIQUE (appointment_id),
  INDEX idx_reviews_visible_created (is_visible, created_at)
);
