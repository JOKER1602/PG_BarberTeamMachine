USE barber_team_machine;

ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash;
