USE barber_team_machine;

ALTER TABLE appointments
  ADD COLUMN cancelled_at DATETIME NULL AFTER cancellation_reason,
  ADD COLUMN completed_at DATETIME NULL AFTER cancelled_at,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL AFTER completed_at,
  ADD CONSTRAINT fk_appointments_updated_by FOREIGN KEY (updated_by) REFERENCES users (id);

UPDATE appointments
SET cancelled_at = updated_at
WHERE status = 'CANCELLED' AND cancelled_at IS NULL;

UPDATE appointments
SET completed_at = updated_at
WHERE status = 'COMPLETED' AND completed_at IS NULL;
