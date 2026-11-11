-- Datos iniciales de una instalación nueva: roles y la barbería inicial.
SET search_path TO reservas;

INSERT INTO roles (name) VALUES ('CLIENTE'), ('ADMINISTRADOR'), ('BARBERO');

WITH tenant AS (
  INSERT INTO tenants (slug, legal_name, display_name, status)
  VALUES ('empyrean-studio', 'Empyrean Studio', 'Empyrean Studio', 'ACTIVE')
  RETURNING id
), settings AS (
  INSERT INTO tenant_settings (tenant_id, business_name, address, city, country, phone, whatsapp, hours_text, maps_url, logo_url, cover_url, description)
  SELECT id, 'Empyrean Studio', 'Buenos Aires 130', 'Cochabamba', 'Bolivia', '77469963', '77469963', 'Lunes a sábado · 10:00 AM — 7:00 PM',
         'https://maps.app.goo.gl/At4qrWe6P2KrDCyW9', '/brand/empyrean-studio-logo.jpg?v=2', '/brand/LogotipoFondoOficial.png', 'Precisión, técnica y estilo para cada visita.'
  FROM tenant
)
INSERT INTO service_categories (tenant_id, name, slug, sort_order)
SELECT tenant.id, category.name, category.slug, category.sort_order
FROM tenant CROSS JOIN (VALUES ('Cortes', 'cortes', 10), ('Barba', 'barba', 20), ('Cejas', 'cejas', 30), ('Otros servicios', 'otros', 90)) AS category (name, slug, sort_order);
