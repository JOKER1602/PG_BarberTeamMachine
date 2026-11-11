import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { TENANT_ADMIN_ROLES, isTenantAdmin, loadOptionalTenantMembership, requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';
import { findAvailableSlotsForDate, loadActiveAppointments, loadAvailability, loadMultiAvailability, sqlDateTime } from '../services/appointment-availability.js';
import { BarberQueueTimeout, withBarberQueue } from '../services/barber-queue.js';
import { isSlotAvailable } from '../domain/availability.js';
import { localDateFilterBounds } from '../config/time.js';
import { cancelAppointmentReminders, scheduleAppointmentReminders } from '../services/reminders.js';
import { notify } from '../services/notifications.js';
import { retryOnDeadlock } from '../middleware/retry-deadlock.js';

// Aislado por tenant: toda cita se lee, crea o modifica dentro de la barbería
// de la URL (tenantIdOf). Administrar significa ser OWNER/ADMIN de ESA barbería.
const router = Router();
const requireTenantAdmin = requireTenantMembership(...TENANT_ADMIN_ROLES);
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
// Candado por barbero para que dos reservas no ocupen el mismo horario. Es de
// transacción: se libera solo al confirmar o deshacer, también si la conexión
// se corta. Los id de barbero son únicos en toda la base, así que no mezcla
// barberías. Ninguna espera de candado de la transacción pasa de 10 s; si no lo
// obtiene responde que reintenten. Dentro de una misma instancia casi nunca
// espera: la fila en memoria (withBarberQueue) ya ordena las peticiones.
async function acquireBarberLock(connection, barberId) {
  try {
    await connection.execute("SET LOCAL lock_timeout = '10s'");
    await connection.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`barber-team-machine-barber-${barberId}`]);
    return true;
  } catch (error) {
    if (error.code === '55P03') return false; // lock_timeout: la ruta hace rollback y responde 409
    throw error;
  }
}

const busyResponse = (response) => response.status(409).json({ message: 'La disponibilidad se está actualizando. Intenta nuevamente.' });

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
      const slots = await findAvailableSlotsForDate(connection, { tenantId: tenantIdOf(request), barberId, serviceIds, date });
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

router.post('/multi', requireRole('CLIENTE'), retryOnDeadlock(async (request, response, next) => {
  const parsed = multiBookingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de las citas invalidos', errors: parsed.error.flatten() });
  const tenantId = tenantIdOf(request);
  const { barberId, startsAt, paymentProofId } = parsed.data;
  const serviceIds = [...new Set(parsed.data.serviceIds)];
  const startAt = new Date(startsAt);
  const invalidProof = () => response.status(400).json({ message: 'El comprobante no existe, no te pertenece o ya fue utilizado.' });
  try {
    // 1. Validaciones sin turno ni transacción: no ocupan una conexión mientras
    //    otras reservas esperan, y quien ya perdió el horario se entera al instante.
    const [proofRows] = await pool.execute(
      'SELECT id FROM payment_proofs WHERE id = ? AND tenant_id = ? AND client_id = ? AND used_at IS NULL',
      [paymentProofId, tenantId, request.auth.sub]
    );
    if (!proofRows.length) return invalidProof();
    const optimisticEndAt = new Date(startAt.getTime() + 24 * 60 * 60_000);
    const availability = await loadMultiAvailability(pool, tenantId, barberId, serviceIds, startAt, optimisticEndAt);
    if (!availability.services) return response.status(400).json({ message: 'El barbero no realiza todos los servicios seleccionados' });
    const endAt = new Date(startAt.getTime() + availability.durationMinutes * 60_000);
    const precheck = isSlotAvailable({ ...availability, startAt, endAt });
    if (!precheck.available) return response.status(409).json({ message: `Horario no disponible: ${precheck.reason}` });

    const totalAmount = availability.services.reduce((total, service) => total + Number(service.price ?? 0), 0);
    const depositAmount = Math.round(totalAmount * 50) / 100;
    const paymentReference = randomUUID();
    // Ruta relativa a la API protegida (sin dominio): solo la abre la administración de la barbería.
    const paymentProofUrl = `/api/t/${request.tenant.slug}/payments/proofs/${paymentProofId}`;

    // 2. Con el turno del barbero: solo lo que necesita estar protegido.
    return await withBarberQueue(barberId, async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (!await acquireBarberLock(connection, barberId)) {
          await connection.rollback();
          return busyResponse(response);
        }
        // Reclama el comprobante: si otra reserva lo usó primero, no queda fila.
        const [claimed] = await connection.execute(
          'UPDATE payment_proofs SET used_at = now() WHERE id = ? AND tenant_id = ? AND client_id = ? AND used_at IS NULL RETURNING id',
          [paymentProofId, tenantId, request.auth.sub]
        );
        if (!claimed.affectedRows) {
          await connection.rollback();
          return invalidProof();
        }
        const appointments = await loadActiveAppointments(connection, tenantId, barberId, startAt, endAt);
        const result = isSlotAvailable({ ...availability, appointments, startAt, endAt });
        if (!result.available) {
          await connection.rollback();
          return response.status(409).json({ message: `Horario no disponible: ${result.reason}` });
        }
        // Todos los servicios en un solo INSERT, encadenados desde el inicio.
        const rows = [];
        let serviceStart = startAt;
        for (const service of availability.services) {
          const serviceEnd = new Date(serviceStart.getTime() + service.durationMinutes * 60_000);
          rows.push([tenantId, request.auth.sub, barberId, service.id, sqlDateTime(serviceStart), sqlDateTime(serviceEnd), paymentReference, paymentProofUrl, depositAmount, request.auth.sub]);
          serviceStart = serviceEnd;
        }
        const [created] = await connection.execute(
          `INSERT INTO appointments (tenant_id, client_id, barber_id, service_id, starts_at, ends_at, status, payment_reference, payment_proof_url, payment_amount, updated_by)
           VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)").join(', ')} RETURNING id`,
          rows.flat()
        );
        const ids = created.rows.map((row) => row.id);
        await notify(connection, {
          tenantId, userId: request.auth.sub, appointmentId: ids[0], type: 'PAYMENT_PENDING', title: 'Anticipo en revisión',
          message: `Recibimos tu comprobante de anticipo por Bs ${depositAmount.toFixed(2)}. Confirmaremos tu cita cuando el pago sea revisado.`
        });
        await connection.commit();
        return response.status(201).json({ ids, paymentReference, status: 'PENDING' });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
  } catch (error) {
    if (error instanceof BarberQueueTimeout) return busyResponse(response);
    return next(error);
  }
}));

router.get('/mine', requireRole('CLIENTE'), async (request, response, next) => {
  try {
    // El historial del cliente en ESTA barbería; sus citas en otras no se ven.
    const [rows] = await pool.execute(
      `SELECT a.id, a.barber_id AS "barberId", a.service_id AS "serviceId",
              a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.cancellation_reason AS "cancellationReason", a.payment_reference AS "paymentReference", a.payment_amount AS "paymentAmount", a.cancelled_at AS "cancelledAt", a.completed_at AS "completedAt",
              s.name AS "serviceName", s.price AS price,
              COALESCE((SELECT SUM(s2.price) FROM appointments a2 JOIN services s2 ON s2.id = a2.service_id AND s2.tenant_id = a2.tenant_id
                        WHERE a2.tenant_id = a.tenant_id AND a2.client_id = a.client_id AND a2.payment_reference = a.payment_reference), s.price) AS "bookingTotal",
              b.display_name AS "barberName", b.photo_url AS "barberPhotoUrl",
              r.id AS "reviewId", r.rating AS "reviewRating"
       FROM appointments a
       JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       JOIN barbers b ON b.id = a.barber_id AND b.tenant_id = a.tenant_id
       LEFT JOIN reviews r ON r.appointment_id = a.id AND r.tenant_id = a.tenant_id
       WHERE a.tenant_id = ? AND a.client_id = ? ORDER BY a.starts_at DESC`,
      [tenantIdOf(request), request.auth.sub]
    );
    return response.json({ appointments: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', requireTenantAdmin, async (request, response, next) => {
  const filters = z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    barberId: z.coerce.number().int().positive().optional(),
    serviceId: z.coerce.number().int().positive().optional(),
    status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional()
  }).safeParse(request.query);
  if (!filters.success) return response.status(400).json({ message: 'Filtros invalidos' });
  const clauses = ['a.tenant_id = ?']; const values = [tenantIdOf(request)];
  const bounds = localDateFilterBounds(filters.data);
  if (bounds.from) { clauses.push('a.starts_at >= ?'); values.push(bounds.from); }
  if (bounds.toExclusive) { clauses.push('a.starts_at < ?'); values.push(bounds.toExclusive); }
  for (const [key, column] of [['barberId', 'a.barber_id'], ['serviceId', 'a.service_id'], ['status', 'a.status']]) if (filters.data[key]) { clauses.push(`${column} = ?`); values.push(filters.data[key]); }
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.client_id AS "clientId", a.barber_id AS "barberId", a.service_id AS "serviceId",
       a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.cancellation_reason AS "cancellationReason", a.payment_reference AS "paymentReference", a.payment_proof_url AS "paymentProofUrl", a.payment_amount AS "paymentAmount",
       a.admin_notes AS "adminNotes", a.cancelled_at AS "cancelledAt", a.completed_at AS "completedAt", a.updated_by AS "updatedBy",
       s.name AS "serviceName", b.display_name AS "barberName",
       CONCAT(u.first_name, ' ', u.last_name) AS "clientName"
       FROM appointments a
       JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       JOIN barbers b ON b.id = a.barber_id AND b.tenant_id = a.tenant_id
       JOIN users u ON u.id = a.client_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY a.starts_at DESC LIMIT 500`, values
    );
    return response.json({ appointments: rows });
  } catch (error) { return next(error); }
});

router.patch('/:id/reschedule', loadOptionalTenantMembership, retryOnDeadlock(async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const body = z.object({ startsAt: z.string().datetime({ offset: true }) }).safeParse(request.body);
  if (!id.success || !body.success) {
    return response.status(400).json({ message: 'Datos de reprogramacion invalidos' });
  }

  const tenantId = tenantIdOf(request);
  const isAdmin = isTenantAdmin(request) ? 1 : 0;
  // El barbero se conoce antes de pedir conexión: la espera de turno no ocupa una.
  let queuedBarber;
  try {
    const [owner] = await pool.execute('SELECT barber_id AS "barberId" FROM appointments WHERE id = ? AND tenant_id = ?', [id.data, tenantId]);
    if (!owner.length) return response.status(404).json({ message: 'Cita no encontrada o no reprogramable' });
    queuedBarber = owner[0].barberId;
  } catch (error) {
    return next(error);
  }
  try {
    return await withBarberQueue(queuedBarber, () => rescheduleWithTurn({ request, response, next, id: id.data, startsAt: body.data.startsAt, tenantId, isAdmin }));
  } catch (error) {
    if (error instanceof BarberQueueTimeout) return busyResponse(response);
    return next(error);
  }
}));

async function rescheduleWithTurn({ request, response, next, id: appointmentId, startsAt, tenantId, isAdmin }) {
  const id = { data: appointmentId };
  const body = { data: { startsAt } };
  const connection = await pool.getConnection();
  let barberId;
  try {
    await connection.beginTransaction();
    // El cliente solo reprograma sus citas futuras; el administrador de esta
    // barbería, cualquiera de sus citas confirmadas.
    // FOR UPDATE: dos peticiones sobre la misma cita se ejecutan una tras otra.
    const [appointmentRows] = await connection.execute(
      `SELECT id, client_id AS "clientId", barber_id AS "barberId", service_id AS "serviceId", status, payment_reference AS "paymentReference"
       FROM appointments WHERE id = ? AND tenant_id = ? AND (client_id = ? OR ? = 1)
       AND status = 'CONFIRMED'
       AND (? = 1 OR starts_at > now()) FOR UPDATE`,
      [id.data, tenantId, request.auth.sub, isAdmin, isAdmin]
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
      `SELECT a.id, a.service_id AS "serviceId", s.duration_minutes AS "durationMinutes"
       FROM appointments a JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       WHERE a.tenant_id = ? AND ${paymentReference ? 'a.payment_reference = ? AND a.client_id = ? AND a.barber_id = ? AND a.status = \'CONFIRMED\'' : 'a.id = ?'}
       ORDER BY a.starts_at, a.id FOR UPDATE OF a`,
      paymentReference ? [tenantId, paymentReference, clientId, barberId] : [tenantId, id.data]
    );
    const bookingIds = bookingRows.map((row) => row.id);
    const startAt = new Date(body.data.startsAt);
    const totalMinutes = bookingRows.reduce((total, row) => total + row.durationMinutes, 0);
    const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);
    const availability = await loadAvailability(connection, tenantId, barberId, bookingRows[0].serviceId, startAt, endAt);
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
        'UPDATE appointments SET starts_at = ?, ends_at = ?, status = ?, updated_by = ? WHERE id = ? AND tenant_id = ?',
        [sqlDateTime(serviceStart), sqlDateTime(serviceEnd), nextStatus, request.auth.sub, row.id, tenantId]
      );
      await cancelAppointmentReminders(connection, row.id, tenantId);
      await scheduleAppointmentReminders(connection, row.id, tenantId);
      serviceStart = serviceEnd;
    }
    await notify(connection, { tenantId, userId: clientId, appointmentId: bookingIds[0], type: 'APPOINTMENT_RESCHEDULED', title: 'Cita reprogramada', message: 'Tu nueva fecha quedó confirmada.' });
    await connection.commit();
    return response.json({ message: bookingIds.length > 1 ? 'Reserva reprogramada y confirmada' : 'Cita reprogramada y confirmada', status: nextStatus, rescheduledIds: bookingIds });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
}

router.patch('/:id/cancel', loadOptionalTenantMembership, retryOnDeadlock(async (request, response, next) => {
  const parsed = z.coerce.number().int().positive().safeParse(request.params.id);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Cita invalida' });
  }

  const body = z.object({ reason: z.string().trim().max(255).optional() }).safeParse(request.body ?? {});
  if (!body.success) return response.status(400).json({ message: 'Motivo de cancelacion invalido' });
  const tenantId = tenantIdOf(request);
  const isAdmin = isTenantAdmin(request) ? 1 : 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [appointmentRows] = await connection.execute(
      `SELECT client_id AS "clientId", payment_reference AS "paymentReference"
       FROM appointments WHERE id = ? AND tenant_id = ? AND (client_id = ? OR ? = 1)
       AND status IN ('PENDING', 'CONFIRMED')
       AND (? = 1 OR starts_at > now()) FOR UPDATE`,
      [parsed.data, tenantId, request.auth.sub, isAdmin, isAdmin]
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
           WHERE tenant_id = ? AND payment_reference = ? AND client_id = ? AND status IN ('PENDING', 'CONFIRMED')
           AND (? = 1 OR starts_at > now()) FOR UPDATE`
        : 'SELECT id FROM appointments WHERE tenant_id = ? AND id = ?',
      appointment.paymentReference
        ? [tenantId, appointment.paymentReference, appointment.clientId, isAdmin]
        : [tenantId, parsed.data]
    );
    const cancelledIds = cancellable.map((row) => row.id);
    await connection.execute(
      `UPDATE appointments SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = now(), updated_by = ?
       WHERE tenant_id = ? AND id IN (${cancelledIds.map(() => '?').join(', ')})`,
      [body.data.reason ?? null, request.auth.sub, tenantId, ...cancelledIds]
    );
    for (const cancelledId of cancelledIds) await cancelAppointmentReminders(connection, cancelledId, tenantId);
    await notify(connection, { tenantId, userId: appointment.clientId, appointmentId: parsed.data, type: 'APPOINTMENT_CANCELLED', title: 'Cita cancelada', message: 'Tu cita fue cancelada' });
    await connection.commit();
    return response.json({ message: cancelledIds.length > 1 ? 'Reserva cancelada' : 'Cita cancelada', cancelledIds });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
}));

router.patch('/:id/status', requireTenantAdmin, retryOnDeadlock(async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({ status: z.enum(['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']), reason: z.string().trim().max(255).optional() }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Cambio de estado invalido' });
  const tenantId = tenantIdOf(request);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT client_id AS "clientId", status, payment_reference AS "paymentReference" FROM appointments WHERE id = ? AND tenant_id = ? AND status IN ('PENDING', 'CONFIRMED')`,
      [id.data, tenantId]
    );
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
           cancelled_at = CASE WHEN ? = 'CANCELLED' THEN now() ELSE cancelled_at END,
           completed_at = CASE WHEN ? = 'COMPLETED' THEN now() ELSE completed_at END,
           updated_by = ?
       WHERE tenant_id = ? AND ${groupCondition}`,
      [parsed.data.status, parsed.data.status === 'CANCELLED' ? parsed.data.reason ?? null : null, parsed.data.status, parsed.data.status, request.auth.sub, tenantId, groupValue]
    );
    // Volver a confirmar una reserva ya aprobada no repite avisos ni recordatorios.
    if (parsed.data.status === 'CONFIRMED' && (isPaymentDecision || !rows[0].paymentReference)) {
      const [confirmed] = await connection.execute(
        `SELECT id, client_id AS "clientId" FROM appointments WHERE tenant_id = ? AND ${isPaymentDecision ? 'payment_reference = ?' : 'id = ?'}`,
        [tenantId, groupValue]
      );
      for (const appointment of confirmed) {
        await scheduleAppointmentReminders(connection, appointment.id, tenantId);
        await notify(connection, { tenantId, userId: appointment.clientId, appointmentId: appointment.id, type: 'APPOINTMENT_CONFIRMED', title: 'Pago aprobado · cita confirmada', message: 'Tu pago fue aprobado y tu cita quedó confirmada.' });
      }
    }
    if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(parsed.data.status)) {
      const [affectedAppointments] = await connection.execute(
        `SELECT id FROM appointments WHERE tenant_id = ? AND ${isPaymentDecision ? 'payment_reference = ?' : 'id = ?'}`,
        [tenantId, groupValue]
      );
      for (const appointment of affectedAppointments) await cancelAppointmentReminders(connection, appointment.id, tenantId);
    }
    const messages = { COMPLETED: ['Cita atendida', 'Tu cita fue marcada como atendida'], NO_SHOW: ['Inasistencia registrada', 'Tu cita fue marcada como no asistida'], CANCELLED: ['Cita cancelada', 'Tu cita fue cancelada'] };
    if (parsed.data.status !== 'CONFIRMED') {
      await notify(connection, { tenantId, userId: rows[0].clientId, appointmentId: id.data, type: `APPOINTMENT_${parsed.data.status}`, title: messages[parsed.data.status][0], message: messages[parsed.data.status][1] });
    }
    await connection.commit();
    return response.json({ message: 'Estado de cita actualizado' });
  } catch (error) { await connection.rollback(); return next(error); } finally { connection.release(); }
}));

router.patch('/:id/admin-notes', requireTenantAdmin, async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = z.object({ adminNotes: z.string().trim().max(1500).nullable() }).safeParse(request.body);
  if (!id.success || !parsed.success) return response.status(400).json({ message: 'Nota interna inválida' });
  try {
    const [result] = await pool.execute(
      'UPDATE appointments SET admin_notes = ?, updated_by = ? WHERE id = ? AND tenant_id = ?',
      [parsed.data.adminNotes, request.auth.sub, id.data, tenantIdOf(request)]
    );
    if (!result.affectedRows) return response.status(404).json({ message: 'Cita no encontrada' });
    return response.json({ message: 'Nota interna guardada' });
  } catch (error) { return next(error); }
});

export default router;
