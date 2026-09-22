USE barber_team_machine;

CREATE TABLE service_categories (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_service_categories_name UNIQUE (name),
  CONSTRAINT uq_service_categories_slug UNIQUE (slug)
);

INSERT INTO service_categories (name, slug, sort_order) VALUES
  ('Cortes', 'cortes', 10),
  ('Barba', 'barba', 20),
  ('Cejas', 'cejas', 30),
  ('Otros servicios', 'otros', 90);

ALTER TABLE services ADD COLUMN category_id SMALLINT UNSIGNED NULL AFTER id;

UPDATE services s
JOIN service_categories c ON c.slug = CASE
  WHEN LOWER(s.name) LIKE '%barba%' THEN 'barba'
  WHEN LOWER(s.name) LIKE '%ceja%' THEN 'cejas'
  WHEN LOWER(s.name) LIKE '%corte%' THEN 'cortes'
  ELSE 'otros'
END
SET s.category_id = c.id;

ALTER TABLE services
  MODIFY category_id SMALLINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_services_category FOREIGN KEY (category_id) REFERENCES service_categories (id),
  ADD INDEX idx_services_category_active (category_id, is_active);
