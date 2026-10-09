import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const uploadDirectory = path.resolve(process.cwd(), 'uploads', 'payments');
mkdirSync(uploadDirectory, { recursive: true });
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const qrUpload = multer({
  storage: multer.diskStorage({ destination: (_request, _file, done) => done(null, uploadDirectory), filename: (_request, file, done) => done(null, `qr-${Date.now()}-${randomUUID()}${imageExtensions[file.mimetype]}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, done) => imageExtensions[file.mimetype] ? done(null, true) : done(Object.assign(new Error('El QR debe ser JPG, PNG o WEBP'), { status: 400 }))
});
const fields = {
  businessName: 'business_name', address: 'address', city: 'city', country: 'country', phone: 'phone', whatsapp: 'whatsapp',
  hoursText: 'hours_text', mapsUrl: 'maps_url', instagramUrl: 'instagram_url', facebookUrl: 'facebook_url', paymentQrUrl: 'payment_qr_url', description: 'description'
};
const selectSettings = `SELECT business_name AS businessName, address, city, country, phone, whatsapp,
  hours_text AS hoursText, maps_url AS mapsUrl, instagram_url AS instagramUrl, facebook_url AS facebookUrl, payment_qr_url AS paymentQrUrl, description
  FROM business_settings WHERE id = 1`;
const settingsSchema = z.object({
  businessName: z.string().trim().min(2).max(160), address: z.string().trim().min(2).max(255), city: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30), whatsapp: z.string().trim().min(6).max(30),
  hoursText: z.string().trim().min(4).max(255), mapsUrl: z.string().url().nullable().optional(), instagramUrl: z.string().url().nullable().optional(),
  facebookUrl: z.string().url().nullable().optional(), paymentQrUrl: z.string().url().nullable().optional(), description: z.string().trim().max(2000).nullable().optional()
});

router.get('/', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(selectSettings);
    return response.json({ settings: rows[0] ?? null });
  } catch (error) { return next(error); }
});

router.patch('/', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Configuración del negocio inválida' });
  try {
    const values = Object.keys(fields).map((key) => parsed.data[key] ?? null);
    await pool.execute(
      `INSERT INTO business_settings (id, ${Object.values(fields).join(', ')}) VALUES (1, ${Object.keys(fields).map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${Object.values(fields).map((field) => `${field} = VALUES(${field})`).join(', ')}`,
      values
    );
    const [rows] = await pool.execute(selectSettings);
    return response.json({ settings: rows[0], message: 'Configuración actualizada' });
  } catch (error) { return next(error); }
});

router.post('/payment-qr', requireAuth, requireRole('ADMINISTRADOR'), qrUpload.single('qr'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen JPG, PNG o WEBP de hasta 5 MB.' });
  try {
    const paymentQrUrl = `${request.protocol}://${request.get('host')}/uploads/payments/${request.file.filename}`;
    await pool.execute('UPDATE business_settings SET payment_qr_url = ? WHERE id = 1', [paymentQrUrl]);
    const [rows] = await pool.execute(selectSettings);
    return response.status(201).json({ paymentQrUrl, settings: rows[0] });
  } catch (error) { return next(error); }
});

export default router;
