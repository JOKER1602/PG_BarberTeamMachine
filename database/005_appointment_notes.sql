USE barber_team_machine;

ALTER TABLE appointments
  ADD COLUMN client_notes TEXT NULL AFTER cancellation_reason,
  ADD COLUMN admin_notes TEXT NULL AFTER client_notes;
