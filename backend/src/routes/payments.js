import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createImageUpload } from '../middleware/image-upload.js';

const router = Router();
const proofUpload = createImageUpload({ folder: 'payments', prefix: 'proof', label: 'comprobante' });

router.post('/proof', requireAuth, requireRole('CLIENTE'), proofUpload.single('proof'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen de comprobante.' });
  const proofId = randomUUID();
  try {
    await pool.execute(
      'INSERT INTO payment_proofs (id, client_id, storage_key) VALUES (?, ?, ?)',
      [proofId, request.auth.sub, request.file.filename]
    );
    return response.status(201).json({ proofId, message: 'Comprobante cargado.' });
  } catch (error) {
    await unlink(path.join(request.file.destination, request.file.filename)).catch(() => {});
    return next(error);
  }
});

// Los comprobantes nunca se sirven como archivos públicos. Solo Administración
// puede abrirlos desde la revisión de pagos.
router.get('/proofs/:proofId', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const proofId = z.string().uuid().safeParse(request.params.proofId);
  if (!proofId.success) return response.status(400).json({ message: 'Comprobante inválido.' });
  try {
    const [rows] = await pool.execute('SELECT storage_key AS storageKey FROM payment_proofs WHERE id = ?', [proofId.data]);
    if (!rows.length) return response.status(404).json({ message: 'Comprobante no encontrado.' });
    return response.sendFile(rows[0].storageKey, { root: path.resolve(process.cwd(), 'uploads', 'payments') }, (error) => {
      if (error && !response.headersSent) next(error);
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
