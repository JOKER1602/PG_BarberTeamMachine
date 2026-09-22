import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { isSlotAvailable } from '../domain/availability.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { barberDayRange, zonedParts } from '../config/time.js';
import { cancelAppointmentReminders, scheduleAppointmentReminders } from '../services/reminders.js';

const router = Router();
const bookingSchema = z.object({
  barberId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive(),
  startsAt: z.string().datetime({ offset: true })
});
const availabilitySchema = z.object({
  barberId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive().optional(),
  serviceIds: z.string().regex(/^\d+(,\d+)*$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).refine((value) => value.serviceId || value.serviceIds, { message: 'Se requiere al menos un servicio' });
const multiBookingSchema = z.object({
  barberId: z.coerce.number().int().positive(),
  serviceIds: z.array(z.coerce.number().int().positive()).min(1).max(10),
  startsAt: z.string().datetime({ offset: true })
});
const activeStatuses = ['PENDING', 'CONFIRMED'];

function sqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function loadAvailability(connection, barberId, serviceId, startAt, endAt) {
  const weekday = zonedParts(startAt).weekday;
  const [serviceRows] = await connection.execute(
    `SELECT s.id, s.duration_minutes AS durationMinutes
     FROM services s JOIN barber_services bs ON bs.service_id = s.id
     WHERE s.id = ? AND s.is_active = TRUE AND bs.barber_id = ?`,
    [serviceId, barberId]
  );
  if (serviceRows.length === 0) {
    return { service: null, workingHours: [], blocks: [], appointments: [] };
  }

  const [workingHours] = await connection.execute(
    `SELECT weekday, TIME_TO_SEC(start_time) DIV 60 AS start_minutes,
            TIME_TO_SEC(end_time) DIV 60 AS end_minutes
     FROM barber_working_hours
     WHERE barber_id = ? AND weekday = ? AND is_active = TRUE`,
    [barberId, weekday]
  );
  const [blocks] = await connection.execute(
    `SELECT starts_at, ends_at FROM schedule_blocks
     WHERE barber_id = ? AND starts_at < ? AND ends_at > ?`,
    [barberId, sqlDateTime(endAt), sqlDateTime(startAt)]
  );
  const [appointments] = await connection.execute(
    `SELECT id, starts_at, ends_at FROM appointments
     WHERE barber_id = ? AND status IN (?, ?) AND starts_at < ? AND ends_at > ?`,
    [barberId, ...activeStatuses, sqlDateTime(endAt), sqlDateTime(startAt)]
  );

  return { service: serviceRows[0], workingHours, blocks, appointments };
}

async function loadMultiAvailability(connection, barberId, serviceIds, startAt, endAt) {
  const uniqueServiceIds = [...new Set(serviceIds)];
  const base = await loadAvailability(connection, barberId, uniqueServiceIds[0], startAt, endAt);
  if (!base.service) return { ...base, services: null, durationMinutes: 0 };
  const placeholders = uniqueServiceIds.map(() => '?').join(', ');
  const [services] = await connection.execute(
    `SELECT s.id, s.duration_minutes AS durationMinutes
     FROM services s JOIN barber_services bs ON bs.service_id = s.id
     WHERE s.id IN (${placeholders}) AND s.is_active = TRUE AND bs.barber_id = ?`,
    [...uniqueServiceIds, barberId]
  );
  if (services.length !== uniqueServiceIds.length) return { ...base, services: null, durationMinutes: 0 };
  const byId = new Map(services.map((service) => [String(service.id), service]));
  const orderedServices = uniqueServiceIds.map((id) => byId.get(String(id)));
  return { ...base, services: orderedServices, durationMinutes: orderedServices.reduce((total, service) => total + service.durationMinutes, 0) };
}

router.get('/availability', async (request, response, next) => {
  const parsed = availabilitySchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Parametros de disponibilidad invalidos' });
  }

  try {
    const { barberId, date } = parsed.data;
    const serviceIds = parsed.data.serviceIds ? parsed.data.serviceIds.split(',').map(Number) : [parsed.data.serviceId];
    const connection = await pool.getConnection();
    try {
      const { start: dayStart, end: dayEnd } = barberDayRange(date);
      const availability = await loadMultiAvailability(connection, barberId, serviceIds, dayStart, dayEnd);
      if (!availability.services) {
        return response.status(404).json({ message: 'El barbero no realiza todos los servicios seleccionados' });
      }

      const slots = [];
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const startAt = new Date(dayStart.getTime() + minute * 60_000);
        const endAt = new Date(startAt.getTime() + availability.durationMinutes * 60_000);
        const result = isSlotAvailable({ ...availability, startAt, endAt });
        if (result.available) {
          slots.push({ startsAt: startAt.toISOString(), endsAt: endAt.toISOString() });
        }
      }

      return response.json({ slots });
    } finally {
      connection.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.use(requireAuth);

router.post('/multi', async (request, response, next) => {
  const parsed = multiBookingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de las citas invalidos', errors: parsed.error.flatten() });
  const connection = await pool.getConnection();
  try {
    const { barberId, startsAt } = parsed.data;
    const serviceIds = [...new Set(parsed.data.serviceIds)];
    const startAt = new Date(startsAt);
    await connection.beginTransaction();
    await connection.execute('SELECT GET_LOCK(?, 10)', [`barber-team-machine-barber-${barberId}`]);
    const optimisticEndAt = new Date(startAt.getTime() + 24 * 60 * 60_000);
    const availability = await loadMultiAvailability(connection, barberId, serviceIds, startAt, optimisticEndAt);
    if (!availability.services) {
      await connection.rollback();
      return response.status(400).json({ message: 'El barbero no realiza todos los servicios seleccionados' });
    }
    const endAt = new Date(startAt.getTime() + availability.durationMinutes * 60_000);
    const finalAvailability = await loadMultiAvailability(connection, barberId, serviceIds, startAt, endAt);
    const result = isSlotAvailable({ ...finalAvailability, startAt, endAt });
    if (!result.available) {
      await connection.rollback();
      return response.status(409).json({ message: `Horario no disponible: ${result.reason}` });
    }
    const ids = [];
    let serviceStart = startAt;
    for (const service of finalAvailability.services) {
      const serviceEnd = new Date(serviceStart.getTime() + service.durationMinutes * 60_000);
      const [created] = await connection.execute(
        `INSERT INTO appointments (client_id, barber_id, service_id, starts_at, ends_at, status, updated_by) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
        [request.auth.sub, barberId, service.id, sqlDateTime(serviceStart), sqlDateTime(serviceEnd), request.auth.sub]
      );
      ids.push(created.insertId);
      serviceStart = serviceEnd;
    }
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message) VALUES (?, ?, 'APPOINTMENT_CREATED', 'Solicitud de reserva recibida', ?)`,
      [request.auth.sub, ids[0], `Tu solicitud para ${finalAvailability.services.length} servicio(s) fue registrada y esta pendiente de confirmacion`]
    );
    await connection.commit();
    return response.status(201).json({ ids, status: 'PENDING' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [`barber-team-machine-barber-${request.body?.barberId}`]).catch(() => {});
    connection.release();
  }
});

router.post('/', async (request, response, next) => {
  const parsed = bookingSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos de la cita invalidos', errors: parsed.error.flatten() });
  }

  const connection = await pool.getConnection();
  try {
    const { barberId, serviceId, startsAt } = parsed.data;
    const startAt = new Date(startsAt);
    await connection.beginTransaction();
    await connection.execute('SELECT GET_LOCK(?, 10)', [`barber-team-machine-barber-${barberId}`]);

    const [serviceRows] = await connection.execute(
      `SELECT s.id, s.duration_minutes AS durationMinutes
       FROM services s JOIN barber_services bs ON bs.service_id = s.id
       WHERE s.id = ? AND s.is_active = TRUE AND bs.barber_id = ?`,
      [serviceId, barberId]
    );
    if (serviceRows.length === 0) {
      await connection.rollback();
      return response.status(400).json({ message: 'El barbero no realiza este servicio' });
    }

    const endAt = new Date(startAt.getTime() + serviceRows[0].durationMinutes * 60_000);
    const availability = await loadAvailability(connection, barberId, serviceId, startAt, endAt);
    const result = isSlotAvailable({ ...availability, startAt, endAt });
    if (!result.available) {
      await connection.rollback();
      return response.status(409).json({ message: `Horario no disponible: ${result.reason}` });
    }

    const [appointmentResult] = await connection.execute(
      `INSERT INTO appointments (client_id, barber_id, service_id, starts_at, ends_at, status, updated_by)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [request.auth.sub, barberId, serviceId, sqlDateTime(startAt), sqlDateTime(endAt), request.auth.sub]
    );
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message)
       VALUES (?, ?, 'APPOINTMENT_CREATED', 'Solicitud de reserva recibida', 'Tu solicitud de cita fue registrada y esta pendiente de confirmacion')`,
      [request.auth.sub, appointmentResult.insertId]
    );
    await connection.commit();
    return response.status(201).json({ id: appointmentResult.insertId, status: 'PENDING' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [`barber-team-machine-barber-${request.body?.barberId}`]).catch(() => {});
    connection.release();
  }
});

router.get('/mine', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
            `SELECT a.id, a.barber_id AS barberId, a.service_id AS serviceId,
              a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.cancelled_at AS cancelledAt, a.completed_at AS completedAt,
              s.name AS serviceName, s.price AS price, b.display_name AS barberName, b.photo_url AS barberPhotoUrl
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN barbers b ON b.id = a.barber_id
       WHERE a.client_id = ? ORDER BY a.starts_at DESC`,
      [request.auth.sub]
    );
    return response.json({ appointments: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const filters = z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    barberId: z.coerce.number().int().positive().optional(),
    serviceId: z.coerce.number().int().positive().optional(),
    status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional()
  }).safeParse(request.query);
  if (!filters.success) return response.status(400).json({ message: 'Filtros invalidos' });
  const clauses = []; const values = [];
  if (filters.data.dateFrom) { clauses.push('a.starts_at >= ?'); values.push(`${filters.data.dateFrom} 00:00:00`); }
  if (filters.data.dateTo) { clauses.push('a.starts_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(filters.data.dateTo); }
  for (const [key, column] of [['barberId', 'a.barber_id'], ['serviceId', 'a.service_id'], ['status', 'a.status']]) if (filters.data[key]) { clauses.push(`${column} = ?`); values.push(filters.data[key]); }
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.client_id AS clientId, a.barber_id AS barberId, a.service_id AS serviceId,
       a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.cancellation_reason AS cancellationReason,
       a.cancelled_at AS cancelledAt, a.completed_at AS completedAt, a.updated_by AS updatedBy,
       s.name AS serviceName, b.display_name AS barberName,
       CONCAT(u.first_name, ' ', u.last_name) AS clientName
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
       JOIN users u ON u.id = a.client_id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY a.starts_at DESC LIMIT 500`, values
    );
    return response.json({ appointments: rows });
  } catch (error) { return next(error); }
});

router.patch('/:id/reschedule', async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const body = z.object({ startsAt: z.string().datetime({ offset: true }) }).safeParse(request.body);
  if (!id.success || !body.success) {
    return response.status(400).json({ message: 'Datos de reprogramacion invalidos' });
  }

  const connection = await pool.getConnection();
  let barberId;
  try {
    await connection.beginTransaction();
    const [appointmentRows] = await connection.execute(
      `SELECT id, client_id AS clientId, barber_id AS barberId, service_id AS serviceId
       FROM appointments WHERE id = ? AND (client_id = ? OR ? = 'ADMINISTRADOR')
       AND status IN ('PENDING', 'CONFIRMED')`,
      [id.data, request.auth.sub, request.auth.role]
    );
    if (appointmentRows.length === 0) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no reprogramable' });
    }

    ({ barberId } = appointmentRows[0]);
    await connection.execute('SELECT GET_LOCK(?, 10)', [`barber-team-machine-barber-${barberId}`]);
    const startAt = new Date(body.data.startsAt);
    const [serviceRows] = await connection.execute('SELECT duration_minutes AS durationMinutes FROM services WHERE id = ?', [appointmentRows[0].serviceId]);
    const endAt = new Date(startAt.getTime() + serviceRows[0].durationMinutes * 60_000);
    const availability = await loadAvailability(connection, barberId, appointmentRows[0].serviceId, startAt, endAt);
    const result = isSlotAvailable({
      ...availability,
      startAt,
      endAt,
      appointments: availability.appointments.filter((appointment) => appointment.id !== id.data)
    });
    if (!result.available) {
      await connection.rollback();
      return response.status(409).json({ message: `Nuevo horario no disponible: ${result.reason}` });
    }

    await connection.execute(
      `UPDATE appointments SET starts_at = ?, ends_at = ?, status = 'PENDING', updated_by = ? WHERE id = ?`,
      [sqlDateTime(startAt), sqlDateTime(endAt), request.auth.sub, id.data]
    );
    await cancelAppointmentReminders(connection, id.data);
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message)
       VALUES (?, ?, 'APPOINTMENT_RESCHEDULED', 'Solicitud reprogramada', 'Tu nueva fecha esta pendiente de confirmacion')`,
      [appointmentRows[0].clientId, id.data]
    );
    await connection.commit();
    return response.json({ message: 'Solicitud de reprogramacion registrada', status: 'PENDING' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    if (barberId) await connection.execute('SELECT RELEASE_LOCK(?)', [`barber-team-machine-barber-${barberId}`]).catch(() => {});
    connection.release();
  }
});

router.patch('/:id/cancel', async (request, response, next) => {
  const parsed = z.coerce.number().int().positive().safeParse(request.params.id);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Cita invalida' });
  }

  const body = z.object({ reason: z.string().trim().max(255).optional() }).safeParse(request.body ?? {});
  if (!body.success) return response.status(400).json({ message: 'Motivo de cancelacion invalido' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE appointments SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = UTC_TIMESTAMP(), updated_by = ?
       WHERE id = ? AND (client_id = ? OR ? = 'ADMINISTRADOR') AND status IN ('PENDING', 'CONFIRMED')`,
      [body.data.reason ?? null, request.auth.sub, parsed.data, request.auth.sub, request.auth.role]
    );
    if (result.affectedRows === 0) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no cancelable' });
    }
    await cancelAppointmentReminders(connection, parsed.data);
    const [appointments] = await connection.execute('SELECT client_id FROM appointments WHERE id = ?', [parsed.data]);
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message)
       VALUES (?, ?, 'APPOINTMENT_CANCELLED', 'Cita cancelada', 'Tu cita fue cancelada')`, [appointments[0].client_id, parsed.data]
    );
    await connection.commit();
    return response.json({ message: 'Cita cancelada' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.patch('/:id/status', requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({ status: z.enum(['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']), reason: z.string().trim().max(255).optional() }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Cambio de estado invalido' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT client_id FROM appointments WHERE id = ? AND status IN ('PENDING', 'CONFIRMED')", [id.data]);
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ message: 'Cita no encontrada o no actualizable' }); }
    await connection.execute(
      `UPDATE appointments
       SET status = ?, cancellation_reason = ?,
           cancelled_at = CASE WHEN ? = 'CANCELLED' THEN UTC_TIMESTAMP() ELSE cancelled_at END,
           completed_at = CASE WHEN ? = 'COMPLETED' THEN UTC_TIMESTAMP() ELSE completed_at END,
           updated_by = ?
       WHERE id = ?`,
      [parsed.data.status, parsed.data.status === 'CANCELLED' ? parsed.data.reason ?? null : null, parsed.data.status, parsed.data.status, request.auth.sub, id.data]
    );
    if (parsed.data.status === 'CONFIRMED') await scheduleAppointmentReminders(connection, id.data);
    if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(parsed.data.status)) await cancelAppointmentReminders(connection, id.data);
    const messages = { CONFIRMED: ['Cita confirmada', 'Tu cita fue confirmada'], COMPLETED: ['Cita atendida', 'Tu cita fue marcada como atendida'], NO_SHOW: ['Inasistencia registrada', 'Tu cita fue marcada como no asistida'], CANCELLED: ['Cita cancelada', 'Tu cita fue cancelada'] };
    await connection.execute('INSERT INTO notifications (user_id, appointment_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [rows[0].client_id, id.data, `APPOINTMENT_${parsed.data.status}`, messages[parsed.data.status][0], messages[parsed.data.status][1]]);
    await connection.commit();
    return response.json({ message: 'Estado de cita actualizado' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
});

export default router;
