import { Router } from 'express';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { cancelAppointmentReminders } from '../services/reminders.js';

const router = Router();

router.patch('/appointments/:id/complete', requireAuth, requireRole('BARBERO'), async (request, response, next) => {
  const appointmentId = Number(request.params.id);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return response.status(400).json({ message: 'Cita inválida' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT a.id, a.client_id AS clientId
       FROM appointments a JOIN barbers b ON b.id = a.barber_id
       WHERE a.id = ? AND b.user_id = ? AND b.is_active = TRUE
       AND a.status IN ('PENDING', 'CONFIRMED')`,
      [appointmentId, request.auth.sub]
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ message: 'Cita no encontrada o no disponible para marcar como atendida' });
    }
    await connection.execute(
      `UPDATE appointments SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?`,
      [request.auth.sub, appointmentId]
    );
    await cancelAppointmentReminders(connection, appointmentId);
    await connection.execute(
      `INSERT INTO notifications (user_id, appointment_id, type, title, message)
       VALUES (?, ?, 'APPOINTMENT_COMPLETED', 'Cita atendida', 'Tu cita fue marcada como atendida')`,
      [rows[0].clientId, appointmentId]
    );
    await connection.commit();
    return response.json({ message: 'Cita marcada como atendida', status: 'COMPLETED' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.get('/dashboard', requireAuth, requireRole('BARBERO'), async (request, response, next) => {
  try {
    const [barberRows] = await pool.execute(
      `SELECT b.id, b.display_name AS displayName, b.bio
       FROM barbers b WHERE b.user_id = ? AND b.is_active = TRUE`,
      [request.auth.sub]
    );
    if (!barberRows.length) return response.status(404).json({ message: 'Tu cuenta no está vinculada a un barbero activo' });

    const barber = barberRows[0];
    const [appointments] = await pool.execute(
      `SELECT a.id, a.starts_at AS startsAt, a.ends_at AS endsAt, a.status,
              s.name AS serviceName, s.duration_minutes AS durationMinutes,
              CONCAT(u.first_name, ' ', u.last_name) AS clientName, u.phone AS clientPhone
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users u ON u.id = a.client_id
       WHERE a.barber_id = ?
       ORDER BY a.starts_at ASC LIMIT 100`,
      [barber.id]
    );
    const [services] = await pool.execute(
      `SELECT s.id, s.name, s.duration_minutes AS durationMinutes
       FROM barber_services bs JOIN services s ON s.id = bs.service_id
       WHERE bs.barber_id = ? AND s.is_active = TRUE ORDER BY s.name`,
      [barber.id]
    );
    const [workingHours] = await pool.execute(
      `SELECT weekday, start_time AS startTime, end_time AS endTime
       FROM barber_working_hours WHERE barber_id = ? AND is_active = TRUE ORDER BY weekday, start_time`,
      [barber.id]
    );
    return response.json({ barber, appointments, services, workingHours });
  } catch (error) {
    return next(error);
  }
});

export default router;
