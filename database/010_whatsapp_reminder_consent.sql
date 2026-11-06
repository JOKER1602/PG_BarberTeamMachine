-- Ejecutar una sola vez en instalaciones existentes, después de respaldar la base.
ALTER TABLE users ADD COLUMN whatsapp_opt_in_at DATETIME NULL AFTER phone;
