import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { createImageUpload } from '../middleware/image-upload.js';
import { TENANT_ADMIN_ROLES, requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';

// Aislado por tenant: profesionales, sus servicios, horarios y bloqueos solo se
// leen o modifican dentro de la barbería de la URL (tenantIdOf).
const router = Router();
const requireTenantAdmin = [requireAuth, requireTenantMembership(...TENANT_ADMIN_ROLES)];
const photoUpload = createImageUpload({ folder: 'barbers', prefix: 'barber', label: 'foto' });
const barberName = z.string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u, 'El nombre solo puede contener letras, espacios, apóstrofes y guiones');

const barberSchema = z.object({
  displayName: barberName,
  bio: z.string().trim().max(2000).optional()
});
const positiveId = z.coerce.number().int().positive();

// Confirma que el profesional pertenece a la barbería antes de tocar sus datos
// relacionados (horarios, bloqueos, servicios), que se referencian por barber_id.
async function barberBelongsToTenant(executor, tenantId, barberId) {
  const [rows] = await executor.execute('SELECT id FROM barbers WHERE id = ? AND tenant_id = ?', [barberId, tenantId]);
  return rows.length > 0;
}

function barberNotFound(response) {
  return response.status(404).json({ message: 'Barbero no encontrado' });
}

router.get('/', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.display_name AS displayName, b.bio, b.photo_url AS photoUrl,
              GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') AS services
       FROM barbers b
       LEFT JOIN barber_services bs ON bs.barber_id = b.id AND bs.tenant_id = b.tenant_id
       LEFT JOIN services s ON s.id = bs.service_id AND s.tenant_id = b.tenant_id AND s.is_active = TRUE
       WHERE b.tenant_id = ? AND b.is_active = TRUE GROUP BY b.id ORDER BY b.display_name`,
      [tenantIdOf(request)]
    );
    return response.json({ barbers: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', ...requireTenantAdmin, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.user_id AS userId, b.display_name AS displayName, b.bio, b.photo_url AS photoUrl, b.is_active AS isActive,
       GROUP_CONCAT(bs.service_id ORDER BY bs.service_id) AS serviceIds
       FROM barbers b LEFT JOIN barber_services bs ON bs.barber_id = b.id AND bs.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?
       GROUP BY b.id ORDER BY b.display_name`,
      [tenantIdOf(request)]
    );
    return response.json({ barbers: rows.map((barber) => ({ ...barber, serviceIds: barber.serviceIds ? barber.serviceIds.split(',').map(Number) : [] })) });
  } catch (error) { return next(error); }
});

router.post('/', ...requireTenantAdmin, async (request, response, next) => {
  const parsed = barberSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos del barbero invalidos', errors: parsed.error.flatten() });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO barbers (tenant_id, display_name, bio) VALUES (?, ?, ?)',
      [tenantIdOf(request), parsed.data.displayName, parsed.data.bio ?? null]
    );
    return response.status(201).json({ id: result.insertId, message: 'Barbero creado' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', ...requireTenantAdmin, async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  const parsed = barberSchema.extend({ isActive: z.boolean().optional() }).partial().safeParse(request.body);
  if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) return response.status(400).json({ message: 'Datos del barbero invalidos' });
  const fields = { displayName: 'display_name', bio: 'bio', isActive: 'is_active' };
  const keys = Object.keys(parsed.data);
  const tenantId = tenantIdOf(request);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [barberRows] = await connection.execute('SELECT user_id AS userId, is_active AS isActive FROM barbers WHERE id = ? AND tenant_id = ? FOR UPDATE', [id.data, tenantId]);
    if (!barberRows.length) { await connection.rollback(); return barberNotFound(response); }
    if (!barberRows[0].isActive && (parsed.data.isActive !== true || keys.length > 1)) {
      await connection.rollback();
      return response.status(409).json({ message: 'Primero reactiva al profesional antes de modificar su ficha' });
    }
    // Desactivar oculta al profesional y bloquea su acceso. Si aún tiene citas
    // por atender, los clientes quedarían con reservas que nadie atenderá.
    if (parsed.data.isActive === false && barberRows[0].isActive) {
      const [[pending]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM appointments
         WHERE barber_id = ? AND tenant_id = ? AND status IN ('PENDING', 'CONFIRMED') AND ends_at > UTC_TIMESTAMP()`,
        [id.data, tenantId]
      );
      if (Number(pending.total) > 0) {
        await connection.rollback();
        return response.status(409).json({
          message: `El profesional tiene ${pending.total} cita(s) pendiente(s) o confirmada(s). Reprográmalas o cancélalas antes de desactivarlo.`,
          upcomingAppointments: Number(pending.total)
        });
      }
    }
    await connection.execute(
      `UPDATE barbers SET ${keys.map((key) => `${fields[key]} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`,
      [...keys.map((key) => parsed.data[key]), id.data, tenantId]
    );
    const { userId } = barberRows[0];
    if (Object.hasOwn(parsed.data, 'isActive') && userId) {
      // El acceso a ESTA barbería se controla con la membresía.
      await connection.execute(
        'UPDATE tenant_memberships SET is_active = ? WHERE tenant_id = ? AND user_id = ?',
        [parsed.data.isActive, tenantId, userId]
      );
      // La cuenta global solo se bloquea si la persona no trabaja en otra
      // barbería: desactivarla aquí no debe dejarla sin acceso en otro tenant.
      await connection.execute(
        `UPDATE users u SET u.is_active = ?
         WHERE u.id = ? AND NOT EXISTS (
           SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id AND m.tenant_id <> ? AND m.is_active = TRUE
         )`,
        [parsed.data.isActive, userId, tenantId]
      );
    }
    await connection.commit();
    return response.json({ message: 'Barbero actualizado' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
});

router.post('/:id/photo', ...requireTenantAdmin, photoUpload.single('photo'), async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  if (!id.success) return response.status(400).json({ message: 'Barbero inválido' });
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen JPG, PNG o WEBP de hasta 5 MB' });
  try {
    const photoUrl = `${request.protocol}://${request.get('host')}/uploads/barbers/${request.file.filename}`;
    const [result] = await pool.execute('UPDATE barbers SET photo_url = ? WHERE id = ? AND tenant_id = ?', [photoUrl, id.data, tenantIdOf(request)]);
    if (!result.affectedRows) return barberNotFound(response);
    return response.status(201).json({ photoUrl, message: 'Foto del barbero actualizada' });
  } catch (error) { return next(error); }
});

router.put('/:id/services', ...requireTenantAdmin, async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  const parsed = z.object({ serviceIds: z.array(positiveId).max(50) }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Servicios del barbero invalidos' });
  const tenantId = tenantIdOf(request);
  const serviceIds = [...new Set(parsed.data.serviceIds)];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!await barberBelongsToTenant(connection, tenantId, id.data)) { await connection.rollback(); return barberNotFound(response); }
    if (serviceIds.length) {
      // Un servicio de otra barbería cuenta como inexistente.
      const [services] = await connection.query(
        `SELECT id FROM services WHERE tenant_id = ? AND id IN (${serviceIds.map(() => '?').join(',')})`,
        [tenantId, ...serviceIds]
      );
      if (services.length !== serviceIds.length) { await connection.rollback(); return response.status(400).json({ message: 'Uno o mas servicios no existen' }); }
    }
    await connection.execute('DELETE FROM barber_services WHERE barber_id = ? AND tenant_id = ?', [id.data, tenantId]);
    for (const serviceId of serviceIds) {
      await connection.execute('INSERT INTO barber_services (tenant_id, barber_id, service_id) VALUES (?, ?, ?)', [tenantId, id.data, serviceId]);
    }
    await connection.commit();
    return response.json({ message: 'Servicios asignados' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
});

const workingHoursSchema = z.object({ weekday: z.number().int().min(1).max(7), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).refine((value) => value.startTime < value.endTime, { message: 'Rango horario invalido' });

router.get('/:id/working-hours', ...requireTenantAdmin, async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  if (!id.success) return response.status(400).json({ message: 'Barbero invalido' });
  try {
    const [rows] = await pool.execute(
      'SELECT id, weekday, start_time AS startTime, end_time AS endTime, is_active AS isActive FROM barber_working_hours WHERE barber_id = ? AND tenant_id = ? ORDER BY weekday, start_time',
      [id.data, tenantIdOf(request)]
    );
    return response.json({ workingHours: rows });
  } catch (error) { return next(error); }
});

router.post('/:id/working-hours', ...requireTenantAdmin, async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  const parsed = workingHoursSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Horario laboral invalido' });
  try {
    const tenantId = tenantIdOf(request);
    if (!await barberBelongsToTenant(pool, tenantId, id.data)) return barberNotFound(response);
    const [result] = await pool.execute(
      'INSERT INTO barber_working_hours (tenant_id, barber_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
      [tenantId, id.data, parsed.data.weekday, parsed.data.startTime, parsed.data.endTime]
    );
    return response.status(201).json({ id: result.insertId, message: 'Horario laboral creado' });
  } catch (error) { return next(error); }
});

router.delete('/:id/working-hours/:workingHourId', ...requireTenantAdmin, async (request, response, next) => {
  const barberId = positiveId.safeParse(request.params.id);
  const hourId = positiveId.safeParse(request.params.workingHourId);
  if (!barberId.success || !hourId.success) return response.status(400).json({ message: 'Horario laboral invalido' });
  try {
    const [result] = await pool.execute('DELETE FROM barber_working_hours WHERE id = ? AND barber_id = ? AND tenant_id = ?', [hourId.data, barberId.data, tenantIdOf(request)]);
    if (!result.affectedRows) return response.status(404).json({ message: 'Horario no encontrado' });
    return response.status(204).send();
  } catch (error) { return next(error); }
});

const blockSchema = z.object({ startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), reason: z.string().trim().max(255).optional() })
  .refine((value) => new Date(value.startsAt) > new Date(), { message: 'El bloqueo debe comenzar en una fecha futura' })
  .refine((value) => new Date(value.startsAt) < new Date(value.endsAt), { message: 'Rango bloqueado invalido' });

router.get('/:id/blocks', ...requireTenantAdmin, async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  if (!id.success) return response.status(400).json({ message: 'Barbero invalido' });
  try {
    const [rows] = await pool.execute(
      'SELECT id, starts_at AS startsAt, ends_at AS endsAt, reason FROM schedule_blocks WHERE barber_id = ? AND tenant_id = ? ORDER BY starts_at DESC',
      [id.data, tenantIdOf(request)]
    );
    return response.json({ blocks: rows });
  } catch (error) { return next(error); }
});

router.post('/:id/blocks', ...requireTenantAdmin, async (request, response, next) => {
  const id = positiveId.safeParse(request.params.id);
  const parsed = blockSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: parsed.success ? 'Barbero invalido' : parsed.error.issues[0]?.message ?? 'Bloqueo invalido' });
  try {
    const tenantId = tenantIdOf(request);
    if (!await barberBelongsToTenant(pool, tenantId, id.data)) return barberNotFound(response);
    const [result] = await pool.execute(
      'INSERT INTO schedule_blocks (tenant_id, barber_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?, ?)',
      [tenantId, id.data, new Date(parsed.data.startsAt), new Date(parsed.data.endsAt), parsed.data.reason ?? null]
    );
    return response.status(201).json({ id: result.insertId, message: 'Bloqueo creado' });
  } catch (error) { return next(error); }
});

router.delete('/:id/blocks/:blockId', ...requireTenantAdmin, async (request, response, next) => {
  const barberId = positiveId.safeParse(request.params.id);
  const blockId = positiveId.safeParse(request.params.blockId);
  if (!barberId.success || !blockId.success) return response.status(400).json({ message: 'Bloqueo invalido' });
  try {
    const [result] = await pool.execute('DELETE FROM schedule_blocks WHERE id = ? AND barber_id = ? AND tenant_id = ?', [blockId.data, barberId.data, tenantIdOf(request)]);
    if (!result.affectedRows) return response.status(404).json({ message: 'Bloqueo no encontrado' });
    return response.status(204).send();
  } catch (error) { return next(error); }
});

export default router;
