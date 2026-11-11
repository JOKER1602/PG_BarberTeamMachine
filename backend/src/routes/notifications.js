import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { tenantIdOf } from '../middleware/tenant.js';

// Aislado por tenant: la bandeja muestra las notificaciones de la persona en
// la barbería de la URL.
const router = Router();

router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, appointment_id AS "appointmentId", type, title, message, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [tenantIdOf(request), request.auth.sub]
    );
    return response.json({ notifications: rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/read', async (request, response, next) => {
  const parsed = z.coerce.number().int().positive().safeParse(request.params.id);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Notificacion invalida' });
  }

  try {
    await pool.execute(
      'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = ? AND tenant_id = ? AND user_id = ?',
      [parsed.data, tenantIdOf(request), request.auth.sub]
    );
    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
