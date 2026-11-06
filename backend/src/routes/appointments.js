import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { findAvailableSlotsForDate, loadAvailability, loadMultiAvailability, sqlDateTime } from '../services/appointment-availability.js';
import { isSlotAvailable } from '../domain/availability.js';
import { localDateFilterBounds } from '../config/time.js';
import { cancelAppointmentReminders, scheduleAppointmentReminders } from '../services/reminders.js';

const router = Router();
const availabilitySchema = z.object({
  barberId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive().optional(),
  serviceIds: z.string().regex(/^\d+(,\d+)*$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).refine((value) => value.serviceId || value.serviceIds, { message: 'Se requiere al menos un servicio' });
const multiBookingSchema = z.object({
  barberId: z.coerce.number().int().positive(),
  serviceIds: z.array(z.coerce.number().int().positive()).min(1).max(10),
  startsAt: z.string().datetime({ offset: true }),
  paymentProofId: z.string().uuid()
});
async function acquireBarberLock(connection, barberId) {
  const [rows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [`barber-team-machine-barber-${barberId}`]);
  return Number(rows[0]?.acquired) === 1;
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
      const slots = await findAvailableSlotsForDate(connection, { barberId, serviceIds, date });
      if (!slots) {
        return response.status(404).json({ message: 'El barbero no realiza todos los servicios seleccionados' });
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

router.post('/multi', requireRole('CLIENTE'), async (request, response, next) => {
  const parsed = multiBookingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de las citas invalidos', errors: parsed.error.flatten() });
  const connection = await pool.getConnection();
  try {
    const { barberId, startsAt, paymentProofId } = parsed.data;
    const serviceIds = [...new Set(parsed.data.serviceIds)];
    const startAt = new Date(startsAt);
    await connection.beginTransaction();
    const [proofRows] = await connection.execute(
      'SELECT id FROM payment_proofs WHERE id = ? AND client_id = ? AND used_at IS NULL FOR UPDATE',
      [paymentProofId, request.auth.sub]
    );
    if (!proofRows.length) {
      await connection.rollback();
      return response.status(400).json({ message: 'El comprobante no existe, no te pertenece o ya fue utilizado.' });
    }
    if (!await acquireBarberLock(connection, barberId)) {
      await connection.rollback();
      return response.status(409).json({ message: 'La disponibilidad se está actualizando. Intenta nuevamente.' });
    }
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
    const totalAmount = finalAvailability.services.reduce((total, service) => total + Number(service.price ?? 0), 0);
    const depositAmount = Math.round(totalAmount * 50) / 100;
    const paymentReference = randomUUID();
    const paymentProofUrl = `${request.protocol}://${request.get('host')}/api/payments/proofs/${paymentProofId}`;
    const ids = [];
    let serviceStart = startAt;
    for (const service of finalAvailability.services) {
      const serviceEnd = new Date(serviceStart.getTime() + service.durationMinutes * 60_000);
      const [created] = await connection.execute(
        `INSERT INTO appointments (client_id, barber_id, service_id, starts_at, ends_at, status, payment_reference, payment_proof_url, payment_amount, updated_by) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        [request.auth.sub, barberId, service.id, sqlDateTime(serviceStart), sqlDateTime(serviceEnd), paymentReference, paymentProofUrl, depositAmount, request.auth.sub]
      );
      ids.push(created.insertId);
      serviceStart = serviceEnd;
    }
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message) VALUES (?, ?, 'PAYMENT_PENDING', 'Anticipo en revisión', ?)`,
      [request.auth.sub, ids[0], `Recibimos tu comprobante de anticipo por Bs ${depositAmount.toFixed(2)}. Confirmaremos tu cita cuando el pago sea revisado.`]
    );
    await connection.execute('UPDATE payment_proofs SET used_at = UTC_TIMESTAMP() WHERE id = ?', [paymentProofId]);
    await connection.commit();
    return response.status(201).json({ ids, paymentReference, status: 'PENDING' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [`barber-team-machine-barber-${request.body?.barberId}`]).catch(() => {});
    connection.release();
  }
});

router.get('/mine', requireRole('CLIENTE'), async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
            `SELECT a.id, a.barber_id AS barberId, a.service_id AS serviceId,
              a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.cancellation_reason AS cancellationReason, a.payment_reference AS paymentReference, a.payment_amount AS paymentAmount, a.cancelled_at AS cancelledAt, a.completed_at AS completedAt,
              s.name AS serviceName, s.price AS price,
              COALESCE((SELECT SUM(s2.price) FROM appointments a2 JOIN services s2 ON s2.id = a2.service_id WHERE a2.client_id = a.client_id AND a2.payment_reference = a.payment_reference), s.price) AS bookingTotal,
              b.display_name AS barberName, b.photo_url AS barberPhotoUrl,
              r.id AS reviewId, r.rating AS reviewRating
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN barbers b ON b.id = a.barber_id
       LEFT JOIN reviews r ON r.appointment_id = a.id
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
  const bounds = localDateFilterBounds(filters.data);
  if (bounds.from) { clauses.push('a.starts_at >= ?'); values.push(bounds.from); }
  if (bounds.toExclusive) { clauses.push('a.starts_at < ?'); values.push(bounds.toExclusive); }
  for (const [key, column] of [['barberId', 'a.barber_id'], ['serviceId', 'a.service_id'], ['status', 'a.status']]) if (filters.data[key]) { clauses.push(`${column} = ?`); values.push(filters.data[key]); }
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.client_id AS clientId, a.barber_id AS barberId, a.service_id AS serviceId,
       a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.cancellation_reason AS cancellationReason, a.payment_reference AS paymentReference, a.payment_proof_url AS paymentProofUrl, a.payment_amount AS paymentAmount,
       a.admin_notes AS adminNotes, a.cancelled_at AS cancelledAt, a.completed_at AS completedAt, a.updated_by AS updatedBy,
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
      `SELECT id, client_id AS clientId, barber_id AS barberId, service_id AS serviceId, status, payment_reference AS paymentReference
       FROM appointments WHERE id = ? AND (client_id = ? OR ? = 'ADMINISTRADOR')
       AND status = 'CONFIRMED'
       AND (? = 'ADMINISTRADOR' OR starts_at > UTC_TIMESTAMP())`,
      [id.data, request.auth.sub, request.auth.role, request.auth.role]
    );
    if (appointmentRows.length === 0) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no reprogramable' });
    }

    ({ barberId } = appointmentRows[0]);
    if (!await acquireBarberLock(connection, barberId)) {
      await connection.rollback();
      return response.status(409).json({ message: 'La disponibilidad se está actualizando. Intenta nuevamente.' });
    }
    // Una reserva de varios servicios se mueve completa: los servicios se
    // encadenan desde el nuevo inicio, en el mismo orden que tenían.
    const { clientId, paymentReference } = appointmentRows[0];
    const [bookingRows] = await connection.execute(
      `SELECT a.id, a.service_id AS serviceId, s.duration_minutes AS durationMinutes
       FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE ${paymentReference ? 'a.payment_reference = ? AND a.client_id = ? AND a.barber_id = ? AND a.status = \'CONFIRMED\'' : 'a.id = ?'}
       ORDER BY a.starts_at, a.id FOR UPDATE`,
      paymentReference ? [paymentReference, clientId, barberId] : [id.data]
    );
    const bookingIds = bookingRows.map((row) => row.id);
    const startAt = new Date(body.data.startsAt);
    const totalMinutes = bookingRows.reduce((total, row) => total + row.durationMinutes, 0);
    const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);
    const availability = await loadAvailability(connection, barberId, bookingRows[0].serviceId, startAt, endAt);
    const result = isSlotAvailable({
      ...availability,
      startAt,
      endAt,
      appointments: availability.appointments.filter((appointment) => !bookingIds.includes(appointment.id))
    });
    if (!result.available) {
      await connection.rollback();
      return response.status(409).json({ message: `Nuevo horario no disponible: ${result.reason}` });
    }

    const nextStatus = 'CONFIRMED';
    let serviceStart = startAt;
    for (const row of bookingRows) {
      const serviceEnd = new Date(serviceStart.getTime() + row.durationMinutes * 60_000);
      await connection.execute(
        `UPDATE appointments SET starts_at = ?, ends_at = ?, status = ?, updated_by = ? WHERE id = ?`,
        [sqlDateTime(serviceStart), sqlDateTime(serviceEnd), nextStatus, request.auth.sub, row.id]
      );
      await cancelAppointmentReminders(connection, row.id);
      await scheduleAppointmentReminders(connection, row.id);
      serviceStart = serviceEnd;
    }
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message)
       VALUES (?, ?, 'APPOINTMENT_RESCHEDULED', 'Cita reprogramada', ?)`,
      [clientId, bookingIds[0], 'Tu nueva fecha quedó confirmada.']
    );
    await connection.commit();
    return response.json({ message: bookingIds.length > 1 ? 'Reserva reprogramada y confirmada' : 'Cita reprogramada y confirmada', status: nextStatus, rescheduledIds: bookingIds });
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
    const [appointmentRows] = await connection.execute(
      `SELECT client_id AS clientId, payment_reference AS paymentReference
       FROM appointments WHERE id = ? AND (client_id = ? OR ? = 'ADMINISTRADOR')
       AND status IN ('PENDING', 'CONFIRMED')
       AND (? = 'ADMINISTRADOR' OR starts_at > UTC_TIMESTAMP()) FOR UPDATE`,
      [parsed.data, request.auth.sub, request.auth.role, request.auth.role]
    );
    if (!appointmentRows.length) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no cancelable' });
    }
    const appointment = appointmentRows[0];
    // Una reserva con anticipo agrupa varios servicios bajo payment_reference.
    // Se cancela completa, tanto si el anticipo sigue en revisión como si ya
    // fue confirmada; solo se excluyen citas ya atendidas, canceladas o pasadas.
    const [cancellable] = await connection.execute(
      appointment.paymentReference
        ? `SELECT id FROM appointments
           WHERE payment_reference = ? AND client_id = ? AND status IN ('PENDING', 'CONFIRMED')
           AND (? = 'ADMINISTRADOR' OR starts_at > UTC_TIMESTAMP()) FOR UPDATE`
        : 'SELECT id FROM appointments WHERE id = ?',
      appointment.paymentReference
        ? [appointment.paymentReference, appointment.clientId, request.auth.role]
        : [parsed.data]
    );
    const cancelledIds = cancellable.map((row) => row.id);
    await connection.execute(
      `UPDATE appointments SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = UTC_TIMESTAMP(), updated_by = ?
       WHERE id IN (${cancelledIds.map(() => '?').join(', ')})`,
      [body.data.reason ?? null, request.auth.sub, ...cancelledIds]
    );
    for (const cancelledId of cancelledIds) await cancelAppointmentReminders(connection, cancelledId);
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message)
       VALUES (?, ?, 'APPOINTMENT_CANCELLED', 'Cita cancelada', 'Tu cita fue cancelada')`, [appointment.clientId, parsed.data]
    );
    await connection.commit();
    return response.json({ message: cancelledIds.length > 1 ? 'Reserva cancelada' : 'Cita cancelada', cancelledIds });
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
    const [rows] = await connection.execute("SELECT client_id AS clientId, status, payment_reference AS paymentReference FROM appointments WHERE id = ? AND status IN ('PENDING', 'CONFIRMED')", [id.data]);
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ message: 'Cita no encontrada o no actualizable' }); }
    if (rows[0].status === 'PENDING' && rows[0].paymentReference && !['CONFIRMED', 'CANCELLED'].includes(parsed.data.status)) {
      await connection.rollback();
      return response.status(400).json({ message: 'Primero aprueba o rechaza el anticipo antes de cambiar esta cita.' });
    }
    const isPaymentDecision = rows[0].status === 'PENDING' && rows[0].paymentReference && ['CONFIRMED', 'CANCELLED'].includes(parsed.data.status);
    const groupCondition = isPaymentDecision ? 'payment_reference = ? AND status = \'PENDING\'' : 'id = ?';
    const groupValue = isPaymentDecision ? rows[0].paymentReference : id.data;
    await connection.execute(
      `UPDATE appointments
       SET status = ?, cancellation_reason = ?,
           cancelled_at = CASE WHEN ? = 'CANCELLED' THEN UTC_TIMESTAMP() ELSE cancelled_at END,
           completed_at = CASE WHEN ? = 'COMPLETED' THEN UTC_TIMESTAMP() ELSE completed_at END,
           updated_by = ?
       WHERE ${groupCondition}`,
      [parsed.data.status, parsed.data.status === 'CANCELLED' ? parsed.data.reason ?? null : null, parsed.data.status, parsed.data.status, request.auth.sub, groupValue]
    );
    if (parsed.data.status === 'CONFIRMED') {
      const [confirmed] = await connection.execute(`SELECT id, client_id AS clientId FROM appointments WHERE ${rows[0].paymentReference ? 'payment_reference = ?' : 'id = ?'}`, [groupValue]);
      for (const appointment of confirmed) {
        await scheduleAppointmentReminders(connection, appointment.id);
        await connection.execute('INSERT INTO notifications (user_id, appointment_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [appointment.clientId, appointment.id, 'APPOINTMENT_CONFIRMED', 'Pago aprobado · cita confirmada', 'Tu pago fue aprobado y tu cita quedó confirmada.']);
      }
    }
    if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(parsed.data.status)) {
      const [affectedAppointments] = await connection.execute(
        `SELECT id FROM appointments WHERE ${isPaymentDecision ? 'payment_reference = ?' : 'id = ?'}`,
        [groupValue]
      );
      for (const appointment of affectedAppointments) await cancelAppointmentReminders(connection, appointment.id);
    }
    const messages = { COMPLETED: ['Cita atendida', 'Tu cita fue marcada como atendida'], NO_SHOW: ['Inasistencia registrada', 'Tu cita fue marcada como no asistida'], CANCELLED: ['Cita cancelada', 'Tu cita fue cancelada'] };
    if (parsed.data.status !== 'CONFIRMED') await connection.execute('INSERT INTO notifications (user_id, appointment_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [rows[0].clientId, id.data, `APPOINTMENT_${parsed.data.status}`, messages[parsed.data.status][0], messages[parsed.data.status][1]]);
    await connection.commit();
    return response.json({ message: 'Estado de cita actualizado' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
});

router.patch('/:id/admin-notes', requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({ adminNotes: z.string().trim().max(1500).nullable() }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Nota interna inválida' });
  try {
    const [result] = await pool.execute('UPDATE appointments SET admin_notes = ?, updated_by = ? WHERE id = ?', [parsed.data.adminNotes, request.auth.sub, id.data]);
    if (!result.affectedRows) return response.status(404).json({ message: 'Cita no encontrada' });
    return response.json({ message: 'Nota interna guardada' });
  } catch (error) { return next(error); }
});

export default router;
