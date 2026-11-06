-- Apply to existing installations after the previous migrations.
-- It preserves a name that was already customized by the administrator.
UPDATE business_settings
SET business_name = 'Empyrean Studio'
WHERE id = 1 AND business_name = 'Barber Team Machine';
