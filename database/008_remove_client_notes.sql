USE barber_team_machine;

-- Las solicitudes del cliente se retiran del sistema por decisión de producto.
-- Ejecutar una sola vez en bases de datos que ya tengan la columna.
ALTER TABLE appointments DROP COLUMN client_notes;
