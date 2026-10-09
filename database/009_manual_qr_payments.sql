USE barber_team_machine;

-- Un comprobante se asocia a todas las citas creadas en una misma reserva.
ALTER TABLE appointments
  ADD COLUMN payment_reference CHAR(36) NULL AFTER status,
  ADD COLUMN payment_proof_url VARCHAR(2048) NULL AFTER payment_reference,
  ADD COLUMN payment_amount DECIMAL(10,2) NULL AFTER payment_proof_url,
  ADD INDEX idx_appointments_payment_reference (payment_reference);

ALTER TABLE business_settings
  ADD COLUMN payment_qr_url VARCHAR(2048) NULL AFTER facebook_url;
