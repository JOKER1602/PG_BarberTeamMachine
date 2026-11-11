-- Se retiran los recordatorios por WhatsApp: los recordatorios quedan solo por
-- correo y dentro de la plataforma. El WhatsApp de contacto de cada barbería
-- (tenant_settings.whatsapp) no cambia.
SET search_path TO reservas;

DELETE FROM reminder_jobs WHERE channel = 'WHATSAPP';

ALTER TABLE reminder_jobs DROP CONSTRAINT IF EXISTS reminder_jobs_channel_check;
ALTER TABLE reminder_jobs ADD CONSTRAINT reminder_jobs_channel_check CHECK (channel IN ('EMAIL', 'IN_APP'));

ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_opt_in_at;
