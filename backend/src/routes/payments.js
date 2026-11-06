import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createImageUpload } from '../middleware/image-upload.js';
import { TENANT_ADMIN_ROLES, requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';

// Aislado por tenant: cada comprobante pertenece a una barbería y a un cliente.
// El archivo se guarda en uploads/payments/<tenant_id>/ y solo lo abre la
// administración de esa barbería.
const router = Router();
const proofUpload = createImageUpload({ folder: 'payments', prefix: 'proof', label: 'comprobante' });
const proofsRoot = path.resolve(process.cwd(), 'uploads', 'payments');

router.post('/proof', requireAuth, requireRole('CLIENTE'), proofUpload.single('proof'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen de comprobante.' });
  const proofId = randomUUID();
  const uploadedPath = path.join(request.file.destination, request.file.filename);
  let storedPath = uploadedPath;
  try {
    const tenantId = tenantIdOf(request);
    const storageKey = `${tenantId}/${request.file.filename}`;
    await mkdir(path.join(proofsRoot, tenantId), { recursive: true });
    storedPath = path.join(proofsRoot, storageKey);
    await rename(uploadedPath, storedPath);
    await pool.execute(
      'INSERT INTO payment_proofs (id, tenant_id, client_id, storage_key) VALUES (?, ?, ?, ?)',
      [proofId, tenantId, request.auth.sub, storageKey]
    );
    return response.status(201).json({ proofId, message: 'Comprobante cargado.' });
  } catch (error) {
    await unlink(storedPath).catch(() => {});
    return next(error);
  }
});

// Los comprobantes nunca se sirven como archivos públicos. Solo Administración
// de la barbería dueña puede abrirlos desde la revisión de pagos.
router.get('/proofs/:proofId', requireAuth, requireTenantMembership(...TENANT_ADMIN_ROLES), async (request, response, next) => {
  const proofId = z.string().uuid().safeParse(request.params.proofId);
  if (!proofId.success) return response.status(400).json({ message: 'Comprobante inválido.' });
  try {
    const [rows] = await pool.execute(
      'SELECT storage_key AS storageKey FROM payment_proofs WHERE id = ? AND tenant_id = ?',
      [proofId.data, tenantIdOf(request)]
    );
    if (!rows.length) return response.status(404).json({ message: 'Comprobante no encontrado.' });
    // Los comprobantes anteriores a la conversión SaaS conservan su ruta plana.
    return response.sendFile(rows[0].storageKey, { root: proofsRoot }, (error) => {
      if (error && !response.headersSent) next(error);
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
