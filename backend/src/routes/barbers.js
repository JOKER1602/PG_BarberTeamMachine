import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const barberSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(2000).optional(),
  photoUrl: z.string().url().max(2048).nullable().optional()
});

router.get('/', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.display_name AS displayName, b.bio, b.photo_url AS photoUrl,
              GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') AS services
       FROM barbers b
       LEFT JOIN barber_services bs ON bs.barber_id = b.id
       LEFT JOIN services s ON s.id = bs.service_id AND s.is_active = TRUE
       WHERE b.is_active = TRUE GROUP BY b.id ORDER BY b.display_name`
    );
    return response.json({ barbers: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', requireAuth, requireRole('ADMINISTRADOR'), async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.user_id AS userId, b.display_name AS displayName, b.bio, b.photo_url AS photoUrl, b.is_active AS isActive,
       GROUP_CONCAT(bs.service_id ORDER BY bs.service_id) AS serviceIds
       FROM barbers b LEFT JOIN barber_services bs ON bs.barber_id = b.id
       GROUP BY b.id ORDER BY b.display_name`
    );
    return response.json({ barbers: rows.map((barber) => ({ ...barber, serviceIds: barber.serviceIds ? barber.serviceIds.split(',').map(Number) : [] })) });
  } catch (error) { return next(error); }
});

router.post('/', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const parsed = barberSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos del barbero invalidos', errors: parsed.error.flatten() });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO barbers (display_name, bio, photo_url) VALUES (?, ?, ?)',
      [parsed.data.displayName, parsed.data.bio ?? null, parsed.data.photoUrl ?? null]
    );
    return response.status(201).json({ id: result.insertId, message: 'Barbero creado' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = barberSchema.extend({ isActive: z.boolean().optional() }).partial().safeParse(request.body);
  if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) return response.status(400).json({ message: 'Datos del barbero invalidos' });
  const fields = { displayName: 'display_name', bio: 'bio', photoUrl: 'photo_url', isActive: 'is_active' };
  const keys = Object.keys(parsed.data);
  try {
    const [result] = await pool.execute(`UPDATE barbers SET ${keys.map((key) => `${fields[key]} = ?`).join(', ')} WHERE id = ?`, [...keys.map((key) => parsed.data[key]), id.data]);
    if (!result.affectedRows) return response.status(404).json({ message: 'Barbero no encontrado' });
    return response.json({ message: 'Barbero actualizado' });
  } catch (error) { return next(error); }
});

router.put('/:id/services', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({ serviceIds: z.array(z.coerce.number().int().positive()).max(50) }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Servicios del barbero invalidos' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [barbers] = await connection.execute('SELECT id FROM barbers WHERE id = ?', [id.data]);
    if (!barbers.length) { await connection.rollback(); return response.status(404).json({ message: 'Barbero no encontrado' }); }
    if (parsed.data.serviceIds.length) {
      const [services] = await connection.query(`SELECT id FROM services WHERE id IN (${parsed.data.serviceIds.map(() => '?').join(',')})`, parsed.data.serviceIds);
      if (services.length !== parsed.data.serviceIds.length) { await connection.rollback(); return response.status(400).json({ message: 'Uno o mas servicios no existen' }); }
    }
    await connection.execute('DELETE FROM barber_services WHERE barber_id = ?', [id.data]);
    for (const serviceId of [...new Set(parsed.data.serviceIds)]) await connection.execute('INSERT INTO barber_services (barber_id, service_id) VALUES (?, ?)', [id.data, serviceId]);
    await connection.commit();
    return response.json({ message: 'Servicios asignados' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
});

const workingHoursSchema = z.object({ weekday: z.number().int().min(1).max(7), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).refine((value) => value.startTime < value.endTime, { message: 'Rango horario invalido' });

router.get('/:id/working-hours', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  if (!id.success) return response.status(400).json({ message: 'Barbero invalido' });
  try { const [rows] = await pool.execute('SELECT id, weekday, start_time AS startTime, end_time AS endTime, is_active AS isActive FROM barber_working_hours WHERE barber_id = ? ORDER BY weekday, start_time', [id.data]); return response.json({ workingHours: rows }); } catch (error) { return next(error); }
});

router.post('/:id/working-hours', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id); const parsed = workingHoursSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Horario laboral invalido' });
  try { const [result] = await pool.execute('INSERT INTO barber_working_hours (barber_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)', [id.data, parsed.data.weekday, parsed.data.startTime, parsed.data.endTime]); return response.status(201).json({ id: result.insertId, message: 'Horario laboral creado' }); } catch (error) { return next(error); }
});

router.delete('/:id/working-hours/:workingHourId', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const barberId = z.coerce.number().int().positive().safeParse(request.params.id); const hourId = z.coerce.number().int().positive().safeParse(request.params.workingHourId);
  if (!barberId.success || !hourId.success) return response.status(400).json({ message: 'Horario laboral invalido' });
  try { const [result] = await pool.execute('DELETE FROM barber_working_hours WHERE id = ? AND barber_id = ?', [hourId.data, barberId.data]); if (!result.affectedRows) return response.status(404).json({ message: 'Horario no encontrado' }); return response.status(204).send(); } catch (error) { return next(error); }
});

const blockSchema = z.object({ startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), reason: z.string().trim().max(255).optional() }).refine((value) => new Date(value.startsAt) < new Date(value.endsAt), { message: 'Rango bloqueado invalido' });
router.get('/:id/blocks', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id); if (!id.success) return response.status(400).json({ message: 'Barbero invalido' });
  try { const [rows] = await pool.execute('SELECT id, starts_at AS startsAt, ends_at AS endsAt, reason FROM schedule_blocks WHERE barber_id = ? ORDER BY starts_at DESC', [id.data]); return response.json({ blocks: rows }); } catch (error) { return next(error); }
});
router.post('/:id/blocks', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id); const parsed = blockSchema.safeParse(request.body); if (!id.success || !parsed.success) return response.status(400).json({ message: 'Bloqueo invalido' });
  try { const [result] = await pool.execute('INSERT INTO schedule_blocks (barber_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?)', [id.data, new Date(parsed.data.startsAt), new Date(parsed.data.endsAt), parsed.data.reason ?? null]); return response.status(201).json({ id: result.insertId, message: 'Bloqueo creado' }); } catch (error) { return next(error); }
});
router.delete('/:id/blocks/:blockId', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const barberId = z.coerce.number().int().positive().safeParse(request.params.id); const blockId = z.coerce.number().int().positive().safeParse(request.params.blockId); if (!barberId.success || !blockId.success) return response.status(400).json({ message: 'Bloqueo invalido' });
  try { const [result] = await pool.execute('DELETE FROM schedule_blocks WHERE id = ? AND barber_id = ?', [blockId.data, barberId.data]); if (!result.affectedRows) return response.status(404).json({ message: 'Bloqueo no encontrado' }); return response.status(204).send(); } catch (error) { return next(error); }
});

export default router;
