import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';
import { cancelAppointmentReminders } from '../services/reminders.js';
import { notify } from '../services/notifications.js';

// Aislado por tenant: el profesional opera solo sus citas en la barbería de la
// URL, con membresía BARBER activa en ella.
const router = Router();
router.use(requireAuth, requireTenantMembership('BARBER'));

router.patch('/appointments/:id/complete', async (request, response, next) => {
  const appointmentId = Number(request.params.id);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return response.status(400).json({ message: 'Cita inválida' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT a.id, a.client_id AS clientId
       FROM appointments a JOIN barbers b ON b.id = a.barber_id AND b.tenant_id = a.tenant_id
       WHERE a.id = ? AND a.tenant_id = ? AND b.user_id = ? AND b.is_active = TRUE
       AND a.status = 'CONFIRMED'`,
      [appointmentId, tenantIdOf(request), request.auth.sub]
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no disponible para marcar como atendida' });
    }
    await connection.execute(
      `UPDATE appointments SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ? AND tenant_id = ?`,
      [request.auth.sub, appointmentId, tenantIdOf(request)]
    );
    await cancelAppointmentReminders(connection, appointmentId, tenantIdOf(request));
    await notify(connection, { tenantId: tenantIdOf(request), userId: rows[0].clientId, appointmentId, type: 'APPOINTMENT_COMPLETED', title: 'Cita atendida', message: 'Tu cita fue marcada como atendida' });
    await connection.commit();
    return response.json({ message: 'Cita marcada como atendida', status: 'COMPLETED' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.patch('/appointments/:id/status', async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const body = z.object({
    status: z.enum(['NO_SHOW', 'CANCELLED']),
    reason: z.string().trim().max(255).optional()
  }).safeParse(request.body);
  if (!id.success || !body.success) return response.status(400).json({ message: 'Actualización de cita inválida' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT a.id, a.client_id AS clientId
       FROM appointments a JOIN barbers b ON b.id = a.barber_id AND b.tenant_id = a.tenant_id
       WHERE a.id = ? AND a.tenant_id = ? AND b.user_id = ? AND b.is_active = TRUE
       AND a.status = 'CONFIRMED'
       FOR UPDATE`,
      [id.data, tenantIdOf(request), request.auth.sub]
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no disponible para actualizar' });
    }

    const isCancellation = body.data.status === 'CANCELLED';
    await connection.execute(
      `UPDATE appointments
       SET status = ?,
           cancellation_reason = CASE WHEN ? THEN ? ELSE cancellation_reason END,
           cancelled_at = CASE WHEN ? THEN UTC_TIMESTAMP() ELSE cancelled_at END,
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [body.data.status, isCancellation, body.data.reason ?? null, isCancellation, request.auth.sub, id.data, tenantIdOf(request)]
    );
    await cancelAppointmentReminders(connection, id.data, tenantIdOf(request));
    await notify(connection, {
      tenantId: tenantIdOf(request),
      userId: rows[0].clientId,
      appointmentId: id.data,
      type: isCancellation ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_NO_SHOW',
      title: isCancellation ? 'Cita cancelada' : 'Cita no asistida',
      message: isCancellation ? 'Tu cita fue cancelada por el profesional.' : 'El profesional registró que no asististe a tu cita.'
    });
    await connection.commit();
    return response.json({
      message: isCancellation ? 'Cita cancelada correctamente' : 'Cita marcada como no asistida',
      status: body.data.status
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.get('/dashboard', async (request, response, next) => {
  const tenantId = tenantIdOf(request);
  try {
    const [barberRows] = await pool.execute(
      `SELECT b.id, b.display_name AS displayName, b.bio
       FROM barbers b WHERE b.tenant_id = ? AND b.user_id = ? AND b.is_active = TRUE`,
      [tenantId, request.auth.sub]
    );
    if (!barberRows.length) return response.status(404).json({ message: 'Tu cuenta no está vinculada a un barbero activo' });

    const barber = barberRows[0];
    const [appointments] = await pool.execute(
      `SELECT a.id, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status, a.admin_notes AS adminNotes,
              s.name AS serviceName, s.duration_minutes AS durationMinutes,
              CONCAT(u.first_name, ' ', u.last_name) AS clientName, u.phone AS clientPhone
       FROM appointments a
       JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       JOIN users u ON u.id = a.client_id
       WHERE a.tenant_id = ? AND a.barber_id = ?
       ORDER BY a.starts_at ASC LIMIT 100`,
      [tenantId, barber.id]
    );
    const [services] = await pool.execute(
      `SELECT s.id, s.name, s.duration_minutes AS durationMinutes
       FROM barber_services bs JOIN services s ON s.id = bs.service_id AND s.tenant_id = bs.tenant_id
       WHERE bs.tenant_id = ? AND bs.barber_id = ? AND s.is_active = TRUE ORDER BY s.name`,
      [tenantId, barber.id]
    );
    const [workingHours] = await pool.execute(
      `SELECT weekday, start_time AS startTime, end_time AS endTime
       FROM barber_working_hours WHERE tenant_id = ? AND barber_id = ? AND is_active = TRUE ORDER BY weekday, start_time`,
      [tenantId, barber.id]
    );
    return response.json({ barber, appointments, services, workingHours });
  } catch (error) {
    return next(error);
  }
});

export default router;
