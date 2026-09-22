USE barber_team_machine;

INSERT INTO roles (name)
SELECT 'BARBERO'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'BARBERO');
