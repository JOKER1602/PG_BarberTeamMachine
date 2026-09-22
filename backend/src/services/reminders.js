import pool from '../config/database.js';
import { isEmailConfigured, sendAppointmentReminderEmail } from './email.js';

const reminderTypes = [['24H', '24 HOUR'], ['2H', '2 HOUR']];

export async function scheduleAppointmentReminders(connection, appointmentId) {
  for (const [type, interval] of reminderTypes) {
    for (const channel of ['EMAIL', 'IN_APP']) {
      await connection.execute(
        `INSERT INTO reminder_jobs (appointment_id, channel, reminder_type, scheduled_at, status, sent_at, attempts, last_error)
         SELECT id, ?, ?, DATE_SUB(starts_at, INTERVAL ${interval}), 'PENDING', NULL, 0, NULL
         FROM appointments WHERE id = ? AND status = 'CONFIRMED'
         ON DUPLICATE KEY UPDATE scheduled_at = VALUES(scheduled_at), status = 'PENDING', sent_at = NULL, attempts = 0, last_error = NULL`,
        [channel, type, appointmentId]
      );
    }
  }
}

export async function cancelAppointmentReminders(connection, appointmentId) {
  await connection.execute("UPDATE reminder_jobs SET status = 'CANCELLED' WHERE appointment_id = ? AND status IN ('PENDING', 'FAILED')", [appointmentId]);
}

export async function processDueReminders() {
  const connection = await pool.getConnection();
  try {
    const [jobs] = await connection.execute(
      `SELECT r.id, r.appointment_id AS appointmentId, r.channel, r.reminder_type AS reminderType, r.attempts,
        a.starts_at AS startsAt, s.name AS serviceName, b.display_name AS barberName,
        u.id AS userId, u.first_name AS firstName, u.email,
        bs.business_name AS businessName, bs.address, bs.city, bs.phone
       FROM reminder_jobs r JOIN appointments a ON a.id = r.appointment_id
       JOIN users u ON u.id = a.client_id JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
       LEFT JOIN business_settings bs ON bs.id = 1
       WHERE r.status = 'PENDING' AND r.scheduled_at <= UTC_TIMESTAMP() AND a.status = 'CONFIRMED'
       ORDER BY r.scheduled_at ASC LIMIT 20`
    );
    for (const job of jobs) {
      if (job.channel === 'EMAIL' && !isEmailConfigured()) continue;
      try {
        if (job.channel === 'EMAIL') await sendAppointmentReminderEmail({ to: job.email, firstName: job.firstName, appointment: job, business: { businessName: job.businessName ?? 'Barber Team Machine', address: job.address ?? '', city: job.city ?? '', phone: job.phone ?? '' } });
        if (job.channel === 'IN_APP') await connection.execute('INSERT INTO notifications (user_id, appointment_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [job.userId, job.appointmentId, `REMINDER_${job.reminderType}`, `Recordatorio de cita (${job.reminderType})`, `Recuerda tu cita de ${job.serviceName} con ${job.barberName}.`]);
        await connection.execute("UPDATE reminder_jobs SET status = 'SENT', sent_at = UTC_TIMESTAMP(), attempts = attempts + 1, last_error = NULL WHERE id = ?", [job.id]);
      } catch (error) {
        await connection.execute("UPDATE reminder_jobs SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= 3 THEN 'FAILED' ELSE 'PENDING' END, scheduled_at = CASE WHEN attempts + 1 >= 3 THEN scheduled_at ELSE DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) END WHERE id = ?", [String(error.message).slice(0, 1000), job.id]);
      }
    }
  } finally { connection.release(); }
}

export function startReminderWorker() {
  processDueReminders().catch((error) => console.error('Error al procesar recordatorios:', error.message));
  const timer = setInterval(() => processDueReminders().catch((error) => console.error('Error al procesar recordatorios:', error.message)), 5 * 60_000);
  timer.unref();
}
