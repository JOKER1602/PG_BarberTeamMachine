import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('ADMINISTRADOR'));

const dashboardFilters = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  barberId: z.coerce.number().int().positive().optional(),
  serviceId: z.coerce.number().int().positive().optional()
});

function appointmentWhere(filters) {
  const clauses = [];
  const values = [];
  if (filters.dateFrom) { clauses.push('a.starts_at >= ?'); values.push(`${filters.dateFrom} 00:00:00`); }
  if (filters.dateTo) { clauses.push('a.starts_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(filters.dateTo); }
  if (filters.barberId) { clauses.push('a.barber_id = ?'); values.push(filters.barberId); }
  if (filters.serviceId) { clauses.push('a.service_id = ?'); values.push(filters.serviceId); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

router.get('/dashboard', async (request, response, next) => {
  const parsed = dashboardFilters.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ message: 'Filtros del panel invalidos' });
  const { where, values } = appointmentWhere(parsed.data);

  try {
    const [metricRows] = await pool.execute(
      `SELECT COUNT(*) AS appointments,
       COALESCE(SUM(a.status = 'COMPLETED'), 0) AS completed,
       COALESCE(SUM(a.status = 'CANCELLED'), 0) AS cancelled,
       COALESCE(SUM(a.status = 'PENDING'), 0) AS pending,
       COALESCE(SUM(a.status = 'CONFIRMED'), 0) AS confirmed,
       COALESCE(SUM(a.status = 'NO_SHOW'), 0) AS noShow,
       COALESCE((SELECT COUNT(*) FROM (
         SELECT a2.client_id FROM appointments a2 ${where.replaceAll('a.', 'a2.')}
         GROUP BY a2.client_id HAVING COUNT(*) > 1
       ) AS recurrent), 0) AS recurringClients
       FROM appointments a ${where}`,
      [...values, ...values]
    );
    const [serviceRows] = await pool.execute(
      `SELECT s.name, COUNT(*) AS total FROM appointments a
       JOIN services s ON s.id = a.service_id ${where}
       GROUP BY s.id, s.name ORDER BY total DESC, s.name ASC LIMIT 6`, values
    );
    const [hourRows] = await pool.execute(
      `SELECT DATE_FORMAT(a.starts_at, '%H:00') AS label, COUNT(*) AS total
       FROM appointments a ${where}
       GROUP BY DATE_FORMAT(a.starts_at, '%H:00')
       ORDER BY label ASC LIMIT 12`, values
    );
    const [statusRows] = await pool.execute(
      `SELECT a.status, COUNT(*) AS total FROM appointments a ${where}
       GROUP BY a.status`, values
    );
    return response.json({ metrics: metricRows[0], serviceUsage: serviceRows, busyHours: hourRows, statuses: statusRows });
  } catch (error) { return next(error); }
});

router.get('/users', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone,
       u.is_active AS isActive, r.name AS role, u.created_at AS createdAt,
       COUNT(a.id) AS appointmentCount
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN appointments a ON a.client_id = u.id
       GROUP BY u.id, r.name ORDER BY u.created_at DESC`
    );
    return response.json({ users: rows });
  } catch (error) { return next(error); }
});

router.post('/barber-accounts', async (request, response, next) => {
  const parsed = z.object({
    barberId: z.coerce.number().int().positive(),
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    email: z.string().email().transform((value) => value.toLowerCase().trim()),
    password: z.string().min(8).max(120),
    phone: z.string().trim().max(30).optional()
  }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de acceso del barbero invalidos' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [barberRows] = await connection.execute('SELECT id, user_id AS userId FROM barbers WHERE id = ? FOR UPDATE', [parsed.data.barberId]);
    if (!barberRows.length) { await connection.rollback(); return response.status(404).json({ message: 'Barbero no encontrado' }); }
    if (barberRows[0].userId) { await connection.rollback(); return response.status(409).json({ message: 'Este barbero ya tiene una cuenta de acceso' }); }
    const [existingUsers] = await connection.execute('SELECT id FROM users WHERE email = ?', [parsed.data.email]);
    if (existingUsers.length) { await connection.rollback(); return response.status(409).json({ message: 'El correo ya esta registrado' }); }
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.default.hash(parsed.data.password, 12);
    const [userResult] = await connection.execute(
      `INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash)
       SELECT id, ?, ?, ?, ?, ? FROM roles WHERE name = 'BARBERO'`,
      [parsed.data.firstName, parsed.data.lastName, parsed.data.email, parsed.data.phone ?? null, passwordHash]
    );
    if (!userResult.insertId) { await connection.rollback(); return response.status(400).json({ message: 'El rol BARBERO no esta configurado' }); }
    await connection.execute('UPDATE barbers SET user_id = ? WHERE id = ?', [userResult.insertId, parsed.data.barberId]);
    await connection.commit();
    return response.status(201).json({ message: 'Cuenta de barbero creada' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
});

router.patch('/users/:id', async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({ isActive: z.boolean() }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Usuario invalido' });
  if (String(id.data) === String(request.auth.sub) && !parsed.data.isActive) return response.status(400).json({ message: 'No puedes desactivar tu propia cuenta' });
  try {
    const [result] = await pool.execute('UPDATE users SET is_active = ? WHERE id = ?', [parsed.data.isActive, id.data]);
    if (!result.affectedRows) return response.status(404).json({ message: 'Usuario no encontrado' });
    return response.json({ message: 'Estado de usuario actualizado' });
  } catch (error) { return next(error); }
});

export default router;
