USE barber_team_machine;

ALTER TABLE appointments
  ADD COLUMN admin_notes TEXT NULL AFTER cancellation_reason;
