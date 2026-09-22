import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, appointment_id AS appointmentId, type, title, message, read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [request.auth.sub]
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
      'UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND user_id = ?',
      [parsed.data, request.auth.sub]
    );
    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
