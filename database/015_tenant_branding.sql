-- SaaS multiempresa · Marca por barbería
--
-- Agrega el logo (cuadrado, monograma) y la portada (imagen ancha del
-- encabezado de reservas) de cada barbería. Solo agrega columnas opcionales:
-- es segura de aplicar sobre una base con 013/014. Requiere 013 (tenant_settings).
--
-- Empyrean Studio conserva las imágenes que ya usaba, servidas por el frontend.
USE barber_team_machine;

ALTER TABLE tenant_settings
  ADD COLUMN logo_url VARCHAR(2048) NULL AFTER payment_qr_url,
  ADD COLUMN cover_url VARCHAR(2048) NULL AFTER logo_url;

UPDATE tenant_settings ts
JOIN tenants t ON t.id = ts.tenant_id
SET ts.logo_url = COALESCE(ts.logo_url, '/brand/empyrean-studio-logo.jpg?v=2'),
    ts.cover_url = COALESCE(ts.cover_url, '/brand/LogotipoFondoOficial.png')
WHERE t.slug = 'empyrean-studio';
