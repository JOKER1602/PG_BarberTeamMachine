import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { tenantIdOf } from '../middleware/tenant.js';

// Aislado por tenant: cada barbería publica solo sus reseñas, y solo se puede
// reseñar una cita atendida de esa misma barbería.
const router = Router();

router.get('/', async (request, response, next) => {
  const barberId = z.coerce.number().int().positive().optional().safeParse(request.query.barberId);
  if (!barberId.success) return response.status(400).json({ message: 'Profesional inválido.' });

  const filter = barberId.data ? 'WHERE tenant_id = ? AND is_visible = TRUE AND barber_id = ?' : 'WHERE tenant_id = ? AND is_visible = TRUE';
  const params = barberId.data ? [tenantIdOf(request), barberId.data] : [tenantIdOf(request)];
  try {
    const [[summary]] = await pool.execute(
      `SELECT COUNT(*) AS total, COALESCE(ROUND(AVG(rating), 1), 0) AS average,
       COALESCE(SUM(rating = 5), 0) AS five, COALESCE(SUM(rating = 4), 0) AS four,
       COALESCE(SUM(rating = 3), 0) AS three, COALESCE(SUM(rating = 2), 0) AS two, COALESCE(SUM(rating = 1), 0) AS one
       FROM reviews ${filter}`,
      params
    );
    const [reviews] = await pool.execute(
      `SELECT r.id, r.rating, r.comment, r.created_at AS createdAt,
       CONCAT(u.first_name, ' ', LEFT(u.last_name, 1), '.') AS clientName,
       b.display_name AS barberName
       FROM reviews r JOIN users u ON u.id = r.client_id
       LEFT JOIN barbers b ON b.id = r.barber_id AND b.tenant_id = r.tenant_id
       ${filter.replaceAll('tenant_id', 'r.tenant_id').replaceAll('is_visible', 'r.is_visible').replaceAll(' barber_id', ' r.barber_id')} ORDER BY r.created_at DESC LIMIT 6`,
      params
    );
    return response.json({ summary, reviews });
  } catch (error) { return next(error); }
});

const createReviewSchema = z.object({
  appointmentId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1500).optional().default('')
});

router.post('/', requireAuth, async (request, response, next) => {
  const parsed = createReviewSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de la reseña inválidos.' });

  try {
    const tenantId = tenantIdOf(request);
    const { appointmentId, rating, comment } = parsed.data;
    const [[appointment]] = await pool.execute(
      `SELECT id, barber_id AS barberId, status
       FROM appointments WHERE id = ? AND tenant_id = ? AND client_id = ?`,
      [appointmentId, tenantId, request.auth.sub]
    );
    if (!appointment) return response.status(404).json({ message: 'No encontramos esa cita.' });
    if (appointment.status !== 'COMPLETED') {
      return response.status(400).json({ message: 'Podrás dejar una reseña cuando la cita figure como atendida.' });
    }
    const [[existing]] = await pool.execute('SELECT id FROM reviews WHERE appointment_id = ? AND tenant_id = ?', [appointmentId, tenantId]);
    if (existing) return response.status(409).json({ message: 'Ya enviaste una reseña para esta cita.' });

    const [created] = await pool.execute(
      `INSERT INTO reviews (tenant_id, client_id, appointment_id, barber_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, request.auth.sub, appointmentId, appointment.barberId, rating, comment]
    );
    return response.status(201).json({ review: { id: created.insertId, appointmentId, rating, comment } });
  } catch (error) { return next(error); }
});

export default router;
