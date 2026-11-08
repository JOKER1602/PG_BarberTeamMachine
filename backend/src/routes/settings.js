import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { createImageUpload } from '../middleware/image-upload.js';
import { TENANT_ADMIN_ROLES, requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';

// Aislado por tenant: cada barbería tiene su fila en tenant_settings
// (reemplaza a business_settings, que era una fila única global).
const router = Router();
const requireTenantAdmin = [requireAuth, requireTenantMembership(...TENANT_ADMIN_ROLES)];
const qrUpload = createImageUpload({ folder: 'qr', prefix: 'qr', label: 'código QR' });
// Marca de la barbería: logo (cuadrado) y portada (imagen ancha). Son públicas.
const brandUpload = createImageUpload({ folder: 'brand', prefix: 'brand', label: 'marca' });
const brandColumns = { logo: 'logo_url', cover: 'cover_url' };
const fields = {
  businessName: 'business_name', address: 'address', city: 'city', country: 'country', phone: 'phone', whatsapp: 'whatsapp',
  hoursText: 'hours_text', mapsUrl: 'maps_url', instagramUrl: 'instagram_url', facebookUrl: 'facebook_url', paymentQrUrl: 'payment_qr_url', description: 'description'
};
const selectSettings = `SELECT business_name AS businessName, address, city, country, phone, whatsapp,
  hours_text AS hoursText, maps_url AS mapsUrl, instagram_url AS instagramUrl, facebook_url AS facebookUrl, payment_qr_url AS paymentQrUrl,
  logo_url AS logoUrl, cover_url AS coverUrl, description
  FROM tenant_settings WHERE tenant_id = ?`;
const settingsSchema = z.object({
  businessName: z.string().trim().min(2).max(160), address: z.string().trim().min(2).max(255), city: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30), whatsapp: z.string().trim().min(6).max(30),
  hoursText: z.string().trim().min(4).max(255), mapsUrl: z.string().url().nullable().optional(), instagramUrl: z.string().url().nullable().optional(),
  facebookUrl: z.string().url().nullable().optional(), paymentQrUrl: z.string().url().nullable().optional(), description: z.string().trim().max(2000).nullable().optional()
});

router.get('/', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(selectSettings, [tenantIdOf(request)]);
    return response.json({ settings: rows[0] ?? null });
  } catch (error) { return next(error); }
});

router.patch('/', ...requireTenantAdmin, async (request, response, next) => {
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Configuración del negocio inválida' });
  try {
    const tenantId = tenantIdOf(request);
    const values = Object.keys(fields).map((key) => parsed.data[key] ?? null);
    await pool.execute(
      `INSERT INTO tenant_settings (tenant_id, ${Object.values(fields).join(', ')}) VALUES (?, ${Object.keys(fields).map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${Object.values(fields).map((field) => `${field} = VALUES(${field})`).join(', ')}`,
      [tenantId, ...values]
    );
    const [rows] = await pool.execute(selectSettings, [tenantId]);
    return response.json({ settings: rows[0], message: 'Configuración actualizada' });
  } catch (error) { return next(error); }
});

router.post('/payment-qr', ...requireTenantAdmin, qrUpload.single('qr'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen JPG, PNG o WEBP de hasta 5 MB.' });
  try {
    const tenantId = tenantIdOf(request);
    const paymentQrUrl = `${request.protocol}://${request.get('host')}/uploads/qr/${request.file.filename}`;
    const [result] = await pool.execute('UPDATE tenant_settings SET payment_qr_url = ? WHERE tenant_id = ?', [paymentQrUrl, tenantId]);
    if (!result.affectedRows) return response.status(409).json({ message: 'Guarda primero los datos del negocio antes de subir el QR.' });
    const [rows] = await pool.execute(selectSettings, [tenantId]);
    return response.status(201).json({ paymentQrUrl, settings: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/brand-image/:kind', ...requireTenantAdmin, brandUpload.single('image'), async (request, response, next) => {
  const column = brandColumns[request.params.kind];
  if (!column) return response.status(400).json({ message: 'Tipo de imagen inválido: usa logo o portada.' });
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen JPG, PNG o WEBP de hasta 5 MB.' });
  try {
    const tenantId = tenantIdOf(request);
    const imageUrl = `${request.protocol}://${request.get('host')}/uploads/brand/${request.file.filename}`;
    const [result] = await pool.execute(`UPDATE tenant_settings SET ${column} = ? WHERE tenant_id = ?`, [imageUrl, tenantId]);
    if (!result.affectedRows) return response.status(409).json({ message: 'Guarda primero los datos del negocio antes de subir la imagen.' });
    const [rows] = await pool.execute(selectSettings, [tenantId]);
    return response.status(201).json({ imageUrl, settings: rows[0] });
  } catch (error) { return next(error); }
});

export default router;
