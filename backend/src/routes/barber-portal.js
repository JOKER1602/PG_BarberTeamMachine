import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';
import { cancelAppointmentReminders } from '../services/reminders.js';
import { notify } from '../services/notifications.js';
import { retryOnDeadlock } from '../middleware/retry-deadlock.js';
import { NOT_STARTED_MESSAGE, UNDO_UNTIL_SQL, UNDO_WINDOW_MINUTES, findUndoableChange, recordStatusChange } from '../services/appointment-status.js';

// Aislado por tenant: el profesional opera solo sus citas en la barbería de la
// URL, con membresía BARBER activa en ella.
const router = Router();
router.use(requireAuth, requireTenantMembership('BARBER'));

// Cita CONFIRMADA del barbero que inicia sesión, bloqueada para actualizarla.
async function lockOwnConfirmedAppointment(connection, request, appointmentId) {
  const [rows] = await connection.execute(
    `SELECT a.id, a.client_id AS "clientId", a.starts_at <= now() AS "hasStarted"
     FROM appointments a JOIN barbers b ON b.id = a.barber_id AND b.tenant_id = a.tenant_id
     WHERE a.id = ? AND a.tenant_id = ? AND b.user_id = ? AND b.is_active = TRUE
     AND a.status = 'CONFIRMED'
     FOR UPDATE OF a`,
    [appointmentId, tenantIdOf(request), request.auth.sub]
  );
  return rows[0] ?? null;
}

router.patch('/appointments/:id/complete', retryOnDeadlock(async (request, response, next) => {
  const appointmentId = Number(request.params.id);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return response.status(400).json({ message: 'Cita inválida' });
  const tenantId = tenantIdOf(request);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const appointment = await lockOwnConfirmedAppointment(connection, request, appointmentId);
    if (!appointment) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no disponible para marcar como atendida' });
    }
    if (!appointment.hasStarted) {
      await connection.rollback();
      return response.status(409).json({ message: NOT_STARTED_MESSAGE });
    }
    await connection.execute(
      `UPDATE appointments SET status = 'COMPLETED', completed_at = now(), updated_by = ? WHERE id = ? AND tenant_id = ?`,
      [request.auth.sub, appointmentId, tenantId]
    );
    await recordStatusChange(connection, { tenantId, appointmentId, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', changedBy: request.auth.sub });
    await cancelAppointmentReminders(connection, appointmentId, tenantId);
    await notify(connection, { tenantId, userId: appointment.clientId, appointmentId, type: 'APPOINTMENT_COMPLETED', title: 'Cita atendida', message: 'Tu cita fue marcada como atendida' });
    await connection.commit();
    return response.json({ message: 'Cita marcada como atendida', status: 'COMPLETED', undoMinutes: UNDO_WINDOW_MINUTES });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
}));

router.patch('/appointments/:id/status', retryOnDeadlock(async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const body = z.object({
    status: z.enum(['NO_SHOW', 'CANCELLED']),
    reason: z.string().trim().max(255).optional()
  }).safeParse(request.body);
  if (!id.success || !body.success) return response.status(400).json({ message: 'Actualización de cita inválida' });
  const tenantId = tenantIdOf(request);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const appointment = await lockOwnConfirmedAppointment(connection, request, id.data);
    if (!appointment) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no disponible para actualizar' });
    }

    const isCancellation = body.data.status === 'CANCELLED';
    // Cancelar se puede antes de la cita; marcar inasistencia, solo desde su hora.
    if (!isCancellation && !appointment.hasStarted) {
      await connection.rollback();
      return response.status(409).json({ message: NOT_STARTED_MESSAGE });
    }
    await connection.execute(
      `UPDATE appointments
       SET status = ?,
           cancellation_reason = CASE WHEN ? THEN ? ELSE cancellation_reason END,
           cancelled_at = CASE WHEN ? THEN now() ELSE cancelled_at END,
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [body.data.status, isCancellation, body.data.reason ?? null, isCancellation, request.auth.sub, id.data, tenantId]
    );
    await recordStatusChange(connection, { tenantId, appointmentId: id.data, fromStatus: 'CONFIRMED', toStatus: body.data.status, changedBy: request.auth.sub, reason: isCancellation ? body.data.reason ?? null : null });
    await cancelAppointmentReminders(connection, id.data, tenantId);
    await notify(connection, {
      tenantId,
      userId: appointment.clientId,
      appointmentId: id.data,
      type: isCancellation ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_NO_SHOW',
      title: isCancellation ? 'Cita cancelada' : 'Cita no asistida',
      message: isCancellation ? 'Tu cita fue cancelada por el profesional.' : 'El profesional registró que no asististe a tu cita.'
    });
    await connection.commit();
    return response.json({
      message: isCancellation ? 'Cita cancelada correctamente' : 'Cita marcada como no asistida',
      status: body.data.status,
      ...(isCancellation ? {} : { undoMinutes: UNDO_WINDOW_MINUTES })
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
}));

// Deshacer: el barbero revierte su propio «Atendida» o «No asistió» durante
// los primeros minutos. La cita vuelve a «Confirmada» y se avisa al cliente.
router.patch('/appointments/:id/undo', retryOnDeadlock(async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  if (!id.success) return response.status(400).json({ message: 'Cita inválida' });
  const tenantId = tenantIdOf(request);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT a.id, a.client_id AS "clientId", a.status
       FROM appointments a JOIN barbers b ON b.id = a.barber_id AND b.tenant_id = a.tenant_id
       WHERE a.id = ? AND a.tenant_id = ? AND b.user_id = ? AND b.is_active = TRUE
       AND a.status IN ('COMPLETED', 'NO_SHOW')
       FOR UPDATE OF a`,
      [id.data, tenantId, request.auth.sub]
    );
    const appointment = rows[0];
    const change = appointment && await findUndoableChange(connection, { tenantId, appointmentId: id.data, userId: request.auth.sub, currentStatus: appointment.status });
    if (!change) {
      await connection.rollback();
      return response.status(409).json({ message: `Ya no se puede deshacer: pasaron más de ${UNDO_WINDOW_MINUTES} minutos. Pide al administrador que corrija el estado.` });
    }
    await connection.execute(
      `UPDATE appointments SET status = ?, completed_at = NULL, updated_by = ? WHERE id = ? AND tenant_id = ?`,
      [change.fromStatus, request.auth.sub, id.data, tenantId]
    );
    await recordStatusChange(connection, { tenantId, appointmentId: id.data, fromStatus: appointment.status, toStatus: change.fromStatus, changedBy: request.auth.sub, kind: 'UNDO' });
    await notify(connection, {
      tenantId, userId: appointment.clientId, appointmentId: id.data, type: 'APPOINTMENT_STATUS_CORRECTED',
      title: 'Corrección de tu cita', message: 'El profesional corrigió un error: tu cita vuelve a estar confirmada.'
    });
    await connection.commit();
    return response.json({ message: 'Cambio deshecho: la cita vuelve a estar confirmada', status: change.fromStatus });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
}));

router.get('/dashboard', async (request, response, next) => {
  const tenantId = tenantIdOf(request);
  try {
    const [barberRows] = await pool.execute(
      `SELECT b.id, b.display_name AS "displayName", b.bio
       FROM barbers b WHERE b.tenant_id = ? AND b.user_id = ? AND b.is_active = TRUE`,
      [tenantId, request.auth.sub]
    );
    if (!barberRows.length) return response.status(404).json({ message: 'Tu cuenta no está vinculada a un barbero activo' });

    const barber = barberRows[0];
    // Citas desde hace 30 días en adelante. Antes eran las 100 más antiguas,
    // y con el tiempo las nuevas dejaban de aparecer.
    const [appointments] = await pool.execute(
      `SELECT a.id, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.admin_notes AS "adminNotes",
              a.starts_at <= now() AS "hasStarted", ${UNDO_UNTIL_SQL} AS "undoUntil",
              s.name AS "serviceName", s.duration_minutes AS "durationMinutes",
              CONCAT(u.first_name, ' ', u.last_name) AS "clientName", u.phone AS "clientPhone"
       FROM appointments a
       JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       JOIN users u ON u.id = a.client_id
       WHERE a.tenant_id = ? AND a.barber_id = ? AND a.starts_at >= now() - interval '30 days'
       ORDER BY a.starts_at ASC LIMIT 300`,
      [tenantId, request.auth.sub, tenantId, barber.id]
    );
    const [services] = await pool.execute(
      `SELECT s.id, s.name, s.duration_minutes AS "durationMinutes"
       FROM barber_services bs JOIN services s ON s.id = bs.service_id AND s.tenant_id = bs.tenant_id
       WHERE bs.tenant_id = ? AND bs.barber_id = ? AND s.is_active = TRUE ORDER BY s.name`,
      [tenantId, barber.id]
    );
    const [workingHours] = await pool.execute(
      `SELECT weekday, start_time AS "startTime", end_time AS "endTime"
       FROM barber_working_hours WHERE tenant_id = ? AND barber_id = ? AND is_active = TRUE ORDER BY weekday, start_time`,
      [tenantId, barber.id]
    );
    return response.json({ barber, appointments, services, workingHours, undoWindowMinutes: UNDO_WINDOW_MINUTES });
  } catch (error) {
    return next(error);
  }
});

export default router;
