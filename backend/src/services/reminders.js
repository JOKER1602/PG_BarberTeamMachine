import pool from '../config/database.js';
import { isEmailConfigured, sendAppointmentReminderEmail } from './email.js';
import { isWhatsAppConfigured, sendWhatsAppReminder } from './whatsapp.js';
import { notify } from './notifications.js';

// Los trabajos de recordatorio heredan el tenant_id de su cita. El worker es
// único para toda la plataforma y procesa todas las barberías.

const reminderTypes = [['24H', '24 HOUR'], ['2H', '2 HOUR']];

// Ambas funciones exigen el tenant de la petición: aunque el llamador ya
// verificó la cita, la consulta nunca toca recordatorios de otra barbería.
function requireTenant(tenantId) {
  if (!tenantId) throw new Error('Los recordatorios requieren tenantId');
}

export async function scheduleAppointmentReminders(connection, appointmentId, tenantId) {
  requireTenant(tenantId);
  for (const [type, interval] of reminderTypes) {
    for (const channel of ['EMAIL', 'IN_APP']) {
      await connection.execute(
        `INSERT INTO reminder_jobs (tenant_id, appointment_id, channel, reminder_type, scheduled_at, status, sent_at, attempts, last_error)
         SELECT tenant_id, id, ?, ?, DATE_SUB(starts_at, INTERVAL ${interval}), 'PENDING', NULL, 0, NULL
         FROM appointments WHERE id = ? AND tenant_id = ? AND status = 'CONFIRMED'
         ON DUPLICATE KEY UPDATE scheduled_at = VALUES(scheduled_at), status = 'PENDING', sent_at = NULL, attempts = 0, last_error = NULL`,
        [channel, type, appointmentId, tenantId]
      );
    }
  }
  await connection.execute(
    `INSERT INTO reminder_jobs (tenant_id, appointment_id, channel, reminder_type, scheduled_at, status, sent_at, attempts, last_error)
     SELECT tenant_id, id, 'WHATSAPP', '2H', DATE_SUB(starts_at, INTERVAL 2 HOUR), 'PENDING', NULL, 0, NULL
     FROM appointments WHERE id = ? AND tenant_id = ? AND status = 'CONFIRMED' AND starts_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR)
     ON DUPLICATE KEY UPDATE scheduled_at = VALUES(scheduled_at), status = 'PENDING', sent_at = NULL, attempts = 0, last_error = NULL`,
    [appointmentId, tenantId]
  );
}

export async function cancelAppointmentReminders(connection, appointmentId, tenantId) {
  requireTenant(tenantId);
  await connection.execute(
    "UPDATE reminder_jobs SET status = 'CANCELLED' WHERE appointment_id = ? AND tenant_id = ? AND status IN ('PENDING', 'FAILED')",
    [appointmentId, tenantId]
  );
}

export async function processDueReminders() {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.execute("SELECT GET_LOCK('empyrean-reminder-worker', 0) AS acquired");
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) return;
    await connection.execute(
      `UPDATE reminder_jobs r JOIN appointments a ON a.id = r.appointment_id
       SET r.status = 'CANCELLED', r.last_error = 'Recordatorio vencido'
       WHERE r.channel = 'WHATSAPP' AND r.status = 'PENDING'
       AND (a.starts_at <= UTC_TIMESTAMP() OR r.scheduled_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))`
    );
    const [jobs] = await connection.execute(
      `SELECT r.id, r.tenant_id AS tenantId, r.appointment_id AS appointmentId, r.channel, r.reminder_type AS reminderType, r.attempts,
        a.starts_at AS startsAt, a.payment_reference AS paymentReference, s.name AS serviceName, b.display_name AS barberName,
        u.id AS userId, u.first_name AS firstName, u.email, u.phone AS clientPhone, u.whatsapp_opt_in_at AS whatsappOptInAt,
        bs.business_name AS businessName, bs.address, bs.city, bs.phone
       FROM reminder_jobs r JOIN appointments a ON a.id = r.appointment_id
       JOIN users u ON u.id = a.client_id JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
       LEFT JOIN tenant_settings bs ON bs.tenant_id = a.tenant_id
       WHERE r.status = 'PENDING' AND r.scheduled_at <= UTC_TIMESTAMP() AND a.status = 'CONFIRMED'
       AND (r.channel <> 'EMAIL' OR ? = 1) AND (r.channel <> 'WHATSAPP' OR ? = 1)
       AND (r.channel <> 'WHATSAPP' OR a.payment_reference IS NULL OR NOT EXISTS (
         SELECT 1 FROM appointments earlier WHERE earlier.payment_reference = a.payment_reference AND earlier.status = 'CONFIRMED'
         AND (earlier.starts_at < a.starts_at OR (earlier.starts_at = a.starts_at AND earlier.id < a.id))
       ))
       ORDER BY r.scheduled_at ASC LIMIT 20`, [Number(isEmailConfigured()), Number(isWhatsAppConfigured())]
    );
    for (const job of jobs) {
      try {
        if (job.channel === 'WHATSAPP') {
          const [current] = await connection.execute('SELECT a.status, a.starts_at > UTC_TIMESTAMP() AS future, u.whatsapp_opt_in_at AS consent, u.phone FROM appointments a JOIN users u ON u.id = a.client_id WHERE a.id = ?', [job.appointmentId]);
          if (!current[0] || current[0].status !== 'CONFIRMED' || !current[0].future || !current[0].consent) {
            await connection.execute("UPDATE reminder_jobs SET status = 'CANCELLED', last_error = 'Cita no confirmada o sin consentimiento' WHERE id = ? AND status = 'PENDING'", [job.id]);
            continue;
          }
          await sendWhatsAppReminder({ phone: current[0].phone, firstName: job.firstName, appointment: job, businessName: job.businessName ?? 'Empyrean Studio' });
        }
        if (job.channel === 'EMAIL') await sendAppointmentReminderEmail({ to: job.email, firstName: job.firstName, appointment: job, business: { businessName: job.businessName ?? 'Empyrean Studio', address: job.address ?? '', city: job.city ?? '', phone: job.phone ?? '' } });
        if (job.channel === 'IN_APP') await notify(connection, { tenantId: job.tenantId, userId: job.userId, appointmentId: job.appointmentId, type: `REMINDER_${job.reminderType}`, title: `Recordatorio de cita (${job.reminderType})`, message: `Recuerda tu cita de ${job.serviceName} con ${job.barberName}.` });
        await connection.execute("UPDATE reminder_jobs SET status = 'SENT', sent_at = UTC_TIMESTAMP(), attempts = attempts + 1, last_error = NULL WHERE id = ?", [job.id]);
        if (job.channel === 'WHATSAPP' && job.paymentReference) {
          await connection.execute("UPDATE reminder_jobs r JOIN appointments a ON a.id = r.appointment_id SET r.status = 'CANCELLED', r.last_error = 'Recordatorio enviado para la reserva' WHERE a.payment_reference = ? AND r.channel = 'WHATSAPP' AND r.id <> ? AND r.status = 'PENDING'", [job.paymentReference, job.id]);
        }
      } catch (error) {
        await connection.execute("UPDATE reminder_jobs SET last_error = ?, status = CASE WHEN attempts >= 2 THEN 'FAILED' ELSE 'PENDING' END, scheduled_at = CASE WHEN attempts >= 2 THEN scheduled_at ELSE DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) END, attempts = attempts + 1 WHERE id = ?", [String(error.message).slice(0, 1000), job.id]);
      }
    }
  } finally {
    if (locked) await connection.execute("SELECT RELEASE_LOCK('empyrean-reminder-worker')").catch(() => {});
    connection.release();
  }
}

export function startReminderWorker() {
  processDueReminders().catch((error) => console.error('Error al procesar recordatorios:', error.message));
  const timer = setInterval(() => processDueReminders().catch((error) => console.error('Error al procesar recordatorios:', error.message)), 5 * 60_000);
  timer.unref();
}
