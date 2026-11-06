-- SaaS multiempresa · Incremento 1: fundamentos
--
-- Solo AGREGA tablas nuevas y el tenant inicial. No modifica tablas existentes,
-- por lo que la API single-tenant actual sigue funcionando igual: todavía no
-- lee estas tablas. Es idempotente: puede ejecutarse más de una vez.
--
-- Las columnas tenant_id y el aislamiento de datos operativos van en
-- 014_tenant_isolation.sql, que NO debe ejecutarse hasta completar el
-- Incremento 2 en la API y el frontend.
USE barber_team_machine;

CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) PRIMARY KEY,
  slug VARCHAR(80) NOT NULL,
  legal_name VARCHAR(160) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  status ENUM('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'TRIAL',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_tenants_slug UNIQUE (slug),
  CONSTRAINT chk_tenants_slug CHECK (slug REGEXP '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

-- Personal de cada barbería. Los clientes no necesitan membresía: su cuenta es
-- global y se relacionan con cada barbería a través de sus reservas.
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('OWNER', 'ADMIN', 'BARBER', 'RECEPTIONIST') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT fk_tenant_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_tenant_memberships_user FOREIGN KEY (user_id) REFERENCES users (id),
  INDEX idx_tenant_memberships_user (user_id, is_active)
);

-- Operadores internos de la plataforma. No administran por defecto los datos
-- de las barberías: gestionan tenants, planes, soporte y suspensiones.
CREATE TABLE IF NOT EXISTS platform_administrators (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_platform_administrators_user FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Reemplazará a business_settings (fila única) en el Incremento 2. Mientras la
-- API siga usando business_settings, 014 vuelve a copiar los datos vigentes.
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id CHAR(36) PRIMARY KEY,
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
  payment_qr_url VARCHAR(2048),
  description TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tenant_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

-- Tenant inicial: la barbería actual conserva todos sus datos.
INSERT INTO tenants (id, slug, legal_name, display_name, status)
SELECT UUID(), 'empyrean-studio', 'Empyrean Studio', 'Empyrean Studio', 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'empyrean-studio');

SET @empyrean_tenant_id := (SELECT id FROM tenants WHERE slug = 'empyrean-studio');

-- Membresías iniciales a partir de los roles globales actuales. Se pueden
-- repetir sin duplicar; 014 las vuelve a sincronizar antes del cambio.
INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active)
SELECT @empyrean_tenant_id, u.id, 'OWNER', u.is_active
FROM users u JOIN roles r ON r.id = u.role_id
WHERE r.name = 'ADMINISTRADOR'
ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = VALUES(is_active);

INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active)
SELECT @empyrean_tenant_id, b.user_id, 'BARBER', b.is_active AND u.is_active
FROM barbers b JOIN users u ON u.id = b.user_id
ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = VALUES(is_active);
