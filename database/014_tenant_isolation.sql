-- SaaS multiempresa · Incremento 2: aislamiento de datos por tenant
--
-- ⚠ NO EJECUTAR TODAVÍA. Después de esta migración toda inserción operativa
-- exige tenant_id: la API actual dejaría de crear servicios, barberos, citas,
-- comprobantes, notificaciones y recordatorios. Se aplica en la misma ventana
-- de mantenimiento que el código del Incremento 2, y solo después de:
--   1. ejecutar 013_saas_foundation.sql;
--   2. respaldar MySQL y backend/uploads, y comprobar que el respaldo restaura;
--   3. ensayar la migración sobre una copia de la base.
--
-- ⚠ NO ES ATÓMICA. En MySQL cada CREATE/ALTER confirma la transacción en curso,
-- así que un fallo a mitad deja la base parcialmente migrada. Ante un error,
-- restaurar el respaldo en lugar de intentar continuar a mano.
USE barber_team_machine;

-- Si 013 no se aplicó, la tabla tenants no existe o el tenant es NULL y el
-- primer INSERT falla antes de tocar cualquier tabla existente.
SET @empyrean_tenant_id := (SELECT id FROM tenants WHERE slug = 'empyrean-studio');

-- 1. Configuración vigente: business_settings siguió recibiendo cambios
--    mientras la API era single-tenant, por eso se copia en este momento.
INSERT INTO tenant_settings (tenant_id, business_name, address, city, country, phone, whatsapp, hours_text, maps_url, instagram_url, facebook_url, payment_qr_url, description)
SELECT @empyrean_tenant_id, business_name, address, city, country, phone, whatsapp, hours_text, maps_url, instagram_url, facebook_url, payment_qr_url, description
FROM business_settings WHERE id = 1
ON DUPLICATE KEY UPDATE
  business_name = VALUES(business_name), address = VALUES(address), city = VALUES(city), country = VALUES(country),
  phone = VALUES(phone), whatsapp = VALUES(whatsapp), hours_text = VALUES(hours_text), maps_url = VALUES(maps_url),
  instagram_url = VALUES(instagram_url), facebook_url = VALUES(facebook_url), payment_qr_url = VALUES(payment_qr_url),
  description = VALUES(description);

-- 2. Membresías: incluye administradores y barberos creados después de 013.
INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active)
SELECT @empyrean_tenant_id, u.id, 'OWNER', u.is_active
FROM users u JOIN roles r ON r.id = u.role_id
WHERE r.name = 'ADMINISTRADOR'
ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = VALUES(is_active);

INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active)
SELECT @empyrean_tenant_id, b.user_id, 'BARBER', b.is_active AND u.is_active
FROM barbers b JOIN users u ON u.id = b.user_id
ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = VALUES(is_active);

-- 3. Columna tenant_id en todos los datos operativos.
ALTER TABLE service_categories ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE barbers ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE services ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE appointments ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE reviews ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE payment_proofs ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE notifications ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE reminder_jobs ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE schedule_blocks ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE barber_working_hours ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE barber_services ADD COLUMN tenant_id CHAR(36) NULL FIRST;

-- 4. Todo lo existente pertenece a Empyrean Studio.
UPDATE service_categories SET tenant_id = @empyrean_tenant_id;
UPDATE barbers SET tenant_id = @empyrean_tenant_id;
UPDATE services SET tenant_id = @empyrean_tenant_id;
UPDATE appointments SET tenant_id = @empyrean_tenant_id;
UPDATE reviews SET tenant_id = @empyrean_tenant_id;
UPDATE payment_proofs SET tenant_id = @empyrean_tenant_id;
UPDATE notifications SET tenant_id = @empyrean_tenant_id;
UPDATE reminder_jobs SET tenant_id = @empyrean_tenant_id;
UPDATE schedule_blocks SET tenant_id = @empyrean_tenant_id;
UPDATE barber_working_hours SET tenant_id = @empyrean_tenant_id;
UPDATE barber_services SET tenant_id = @empyrean_tenant_id;

-- 5. Obligatoriedad, llaves foráneas e índices únicos compuestos por tenant.
--    Las llaves foráneas fallan aquí si el tenant inicial no existe.
ALTER TABLE service_categories
  DROP INDEX uq_service_categories_name,
  DROP INDEX uq_service_categories_slug,
  MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_service_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD CONSTRAINT uq_service_categories_tenant_name UNIQUE (tenant_id, name),
  ADD CONSTRAINT uq_service_categories_tenant_slug UNIQUE (tenant_id, slug);
ALTER TABLE barbers MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_barbers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_barbers_tenant_active (tenant_id, is_active);
ALTER TABLE services DROP INDEX name,
  MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD UNIQUE KEY uq_services_tenant_name (tenant_id, name),
  ADD INDEX idx_services_tenant_active (tenant_id, is_active);
ALTER TABLE appointments MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_appointments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_appointments_tenant_range (tenant_id, starts_at, ends_at);
ALTER TABLE reviews MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_reviews_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_reviews_tenant_visible (tenant_id, is_visible, created_at);
ALTER TABLE payment_proofs MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_payment_proofs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_payment_proofs_tenant_owner (tenant_id, client_id, used_at);
ALTER TABLE notifications MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_notifications_tenant_user (tenant_id, user_id, read_at);
ALTER TABLE reminder_jobs MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_reminder_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_reminder_jobs_tenant_pending (tenant_id, status, scheduled_at);
ALTER TABLE schedule_blocks MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_schedule_blocks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id);
ALTER TABLE barber_working_hours MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_barber_working_hours_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id);
ALTER TABLE barber_services MODIFY tenant_id CHAR(36) NOT NULL,
  ADD CONSTRAINT fk_barber_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD INDEX idx_barber_services_tenant (tenant_id, barber_id, service_id);
