-- Colores propios por barbería (acento, fondo y texto, en #RRGGBB).
-- Vacíos = los colores por defecto del diseño (los de Empyrean Studio).
-- Los fija el operador de la plataforma al crear o editar la barbería.
SET search_path TO reservas;

ALTER TABLE tenant_settings
  ADD COLUMN theme_accent VARCHAR(7) CHECK (theme_accent ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN theme_background VARCHAR(7) CHECK (theme_background ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN theme_text VARCHAR(7) CHECK (theme_text ~ '^#[0-9A-Fa-f]{6}$');
