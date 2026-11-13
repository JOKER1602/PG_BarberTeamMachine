-- Clientes de cada barbería.
-- Las cuentas son globales (una persona puede reservar en varias barberías),
-- pero cada barbería solo debe ver a sus propios clientes. Antes, un cliente
-- aparecía en el panel solo después de su primera reserva; con esta tabla
-- aparece desde que se registra o inicia sesión en la página de la barbería.
SET search_path TO reservas;

CREATE TABLE tenant_clients (
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX idx_tenant_clients_user ON tenant_clients (user_id);

-- Clientes que ya reservaron en una barbería.
INSERT INTO tenant_clients (tenant_id, user_id, created_at)
SELECT a.tenant_id, a.client_id, min(a.created_at)
FROM appointments a
GROUP BY a.tenant_id, a.client_id
ON CONFLICT DO NOTHING;

-- Clientes registrados antes de existir esta tabla y que aún no reservaron:
-- se asignan a la barbería inicial de la instalación, la única que había.
INSERT INTO tenant_clients (tenant_id, user_id, created_at)
SELECT t.id, u.id, u.created_at
FROM users u
JOIN roles r ON r.id = u.role_id AND r.name = 'CLIENTE'
JOIN tenants t ON t.slug = 'empyrean-studio'
WHERE NOT EXISTS (SELECT 1 FROM tenant_clients tc WHERE tc.user_id = u.id)
ON CONFLICT DO NOTHING;
