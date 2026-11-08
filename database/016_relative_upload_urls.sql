-- Rutas relativas para archivos subidos
--
-- Fotos, QR, logos, portadas y enlaces a comprobantes se guardaban con el
-- dominio incluido (p. ej. http://localhost:3002/uploads/...). Al cambiar de
-- dominio o mover la base a producción esos enlaces se rompen. Esta migración
-- deja solo la ruta (/uploads/... o /api/t/...). Es idempotente y no toca
-- valores que ya son relativos ni imágenes externas que no sean de /uploads.
-- Requiere 013-015.
USE barber_team_machine;

UPDATE barbers
SET photo_url = SUBSTRING(photo_url, LOCATE('/uploads/', photo_url))
WHERE photo_url REGEXP '^https?://[^/]+/uploads/';

UPDATE tenant_settings
SET payment_qr_url = IF(payment_qr_url REGEXP '^https?://[^/]+/uploads/', SUBSTRING(payment_qr_url, LOCATE('/uploads/', payment_qr_url)), payment_qr_url),
    logo_url = IF(logo_url REGEXP '^https?://[^/]+/uploads/', SUBSTRING(logo_url, LOCATE('/uploads/', logo_url)), logo_url),
    cover_url = IF(cover_url REGEXP '^https?://[^/]+/uploads/', SUBSTRING(cover_url, LOCATE('/uploads/', cover_url)), cover_url);

UPDATE appointments
SET payment_proof_url = SUBSTRING(payment_proof_url, LOCATE('/api/', payment_proof_url))
WHERE payment_proof_url REGEXP '^https?://[^/]+/api/';

UPDATE appointments
SET payment_proof_url = SUBSTRING(payment_proof_url, LOCATE('/uploads/', payment_proof_url))
WHERE payment_proof_url REGEXP '^https?://[^/]+/uploads/';
