USE barber_team_machine;

-- Los comprobantes se registran antes de crear la reserva. Esto permite
-- comprobar su propietario y evitar reutilizarlos o aceptar URLs externas.
CREATE TABLE payment_proofs (
  id CHAR(36) PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(255) NOT NULL UNIQUE,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_proofs_client FOREIGN KEY (client_id) REFERENCES users (id),
  INDEX idx_payment_proofs_owner_status (client_id, used_at, created_at)
);
