import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { localDateFilterBounds, localSqlTime } from '../config/time.js';
import { resolveDefaultTenant, tenantIdOf } from '../middleware/tenant.js';

// SaaS: este módulo se monta solo para la barbería por defecto (app.js) porque
// el panel y la lista de usuarios aún no filtran por tenant (Incremento 2,
// paso de analítica). Las cuentas de barbero ya usan tenantIdOf.

const router = Router();
router.use(requireAuth, requireRole('ADMINISTRADOR'));
// La barbería se resuelve después de autenticar: una petición anónima recibe
// 401 sin consultar la base.
router.use(resolveDefaultTenant);

const personalName = z.string().trim().min(2).max(80).regex(/^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u, 'El nombre contiene caracteres no permitidos');

const dashboardFilters = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  barberId: z.coerce.number().int().positive().optional(),
  serviceId: z.coerce.number().int().positive().optional()
});

function appointmentWhere(filters) {
  const clauses = [];
  const values = [];
  // Los filtros son días de Cochabamba; las citas se guardan en UTC.
  const bounds = localDateFilterBounds(filters);
  if (bounds.from) { clauses.push('a.starts_at >= ?'); values.push(bounds.from); }
  if (bounds.toExclusive) { clauses.push('a.starts_at < ?'); values.push(bounds.toExclusive); }
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
       COALESCE(SUM(CASE WHEN a.status IN ('CONFIRMED', 'COMPLETED') THEN s.price ELSE 0 END), 0) AS confirmedRevenue,
       COALESCE(SUM(CASE WHEN a.status = 'COMPLETED' THEN s.price ELSE 0 END), 0) AS completedRevenue,
       COALESCE(SUM(CASE WHEN a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED') THEN TIMESTAMPDIFF(MINUTE, a.starts_at, a.ends_at) ELSE 0 END), 0) AS occupiedMinutes,
       COALESCE((SELECT COUNT(*) FROM (
         SELECT a2.client_id FROM appointments a2 ${where.replaceAll('a.', 'a2.')}
         GROUP BY a2.client_id HAVING COUNT(*) > 1
       ) AS recurrent), 0) AS recurringClients
       FROM appointments a JOIN services s ON s.id = a.service_id ${where}`,
      [...values, ...values]
    );
    const [serviceRows] = await pool.execute(
      `SELECT s.name, COUNT(*) AS total FROM appointments a
       JOIN services s ON s.id = a.service_id ${where}
       GROUP BY s.id, s.name ORDER BY total DESC, s.name ASC LIMIT 6`, values
    );
    const [hourRows] = await pool.execute(
      `SELECT DATE_FORMAT(${localSqlTime('a.starts_at')}, '%H:00') AS label, COUNT(*) AS total
       FROM appointments a ${where}
       GROUP BY label
       ORDER BY label ASC LIMIT 12`, values
    );
    const [statusRows] = await pool.execute(
      `SELECT a.status, COUNT(*) AS total FROM appointments a ${where}
       GROUP BY a.status`, values
    );
    const [dailyRows] = await pool.execute(
      `SELECT * FROM (
         SELECT DATE_FORMAT(${localSqlTime('a.starts_at')}, '%Y-%m-%d') AS date, COUNT(*) AS total,
         COALESCE(SUM(a.status = 'COMPLETED'), 0) AS completed
         FROM appointments a ${where}
         GROUP BY date
         ORDER BY date DESC LIMIT 31
       ) AS latest_days ORDER BY date ASC`, values
    );
    const [barberRows] = await pool.execute(
      `SELECT b.id, b.display_name AS name, COUNT(*) AS total,
       COALESCE(SUM(a.status = 'COMPLETED'), 0) AS completed,
       COALESCE(SUM(a.status = 'NO_SHOW'), 0) AS noShow,
       COALESCE(SUM(CASE WHEN a.status IN ('CONFIRMED', 'COMPLETED') THEN s.price ELSE 0 END), 0) AS revenue,
       COALESCE(SUM(CASE WHEN a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED') THEN TIMESTAMPDIFF(MINUTE, a.starts_at, a.ends_at) ELSE 0 END), 0) AS occupiedMinutes
       FROM appointments a JOIN barbers b ON b.id = a.barber_id JOIN services s ON s.id = a.service_id ${where}
       GROUP BY b.id, b.display_name ORDER BY total DESC, b.display_name ASC LIMIT 8`, values
    );
    const [clientRows] = await pool.execute(
      `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, COUNT(*) AS total,
       MAX(a.starts_at) AS lastVisit
       FROM appointments a JOIN users u ON u.id = a.client_id ${where}
       GROUP BY u.id, u.first_name, u.last_name
       HAVING COUNT(*) > 1
       ORDER BY total DESC, lastVisit DESC LIMIT 8`, values
    );
    return response.json({
      metrics: metricRows[0],
      serviceUsage: serviceRows,
      busyHours: hourRows,
      statuses: statusRows,
      dailyAppointments: dailyRows,
      barberPerformance: barberRows,
      recurringClients: clientRows
    });
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
    firstName: personalName.optional(),
    lastName: personalName.optional(),
    email: z.string().email().transform((value) => value.toLowerCase().trim()),
    password: z.string().min(8).max(120),
    phone: z.string().trim().regex(/^(?:[67]\d{7})?$/, 'El teléfono debe tener 8 dígitos y comenzar con 6 o 7').optional()
  }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de acceso del barbero invalidos' });

  const tenantId = tenantIdOf(request);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [barberRows] = await connection.execute('SELECT id, display_name AS displayName, user_id AS userId FROM barbers WHERE id = ? AND tenant_id = ? FOR UPDATE', [parsed.data.barberId, tenantId]);
    if (!barberRows.length) { await connection.rollback(); return response.status(404).json({ message: 'Barbero no encontrado' }); }
    if (barberRows[0].userId) { await connection.rollback(); return response.status(409).json({ message: 'Este barbero ya tiene una cuenta de acceso' }); }
    const [existingUsers] = await connection.execute('SELECT id FROM users WHERE email = ?', [parsed.data.email]);
    if (existingUsers.length) { await connection.rollback(); return response.status(409).json({ message: 'El correo ya esta registrado' }); }
    const nameParts = barberRows[0].displayName.trim().split(/\s+/);
    const firstName = parsed.data.firstName ?? nameParts.shift();
    const lastName = parsed.data.lastName ?? (nameParts.join(' ') || 'Barbero');
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.default.hash(parsed.data.password, 12);
    const [userResult] = await connection.execute(
      `INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash, must_change_password)
       SELECT id, ?, ?, ?, ?, ?, TRUE FROM roles WHERE name = 'BARBERO'`,
      [firstName, lastName, parsed.data.email, parsed.data.phone || null, passwordHash]
    );
    if (!userResult.insertId) { await connection.rollback(); return response.status(400).json({ message: 'El rol BARBERO no esta configurado' }); }
    await connection.execute('UPDATE barbers SET user_id = ? WHERE id = ? AND tenant_id = ?', [userResult.insertId, parsed.data.barberId, tenantId]);
    // El acceso del profesional a esta barbería se concede con su membresía.
    await connection.execute(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active) VALUES (?, ?, 'BARBER', TRUE)
       ON DUPLICATE KEY UPDATE role = 'BARBER', is_active = TRUE`,
      [tenantId, userResult.insertId]
    );
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
