import pool from '../config/database.js';
import { isEmailConfigured, sendAppointmentReminderEmail } from './email.js';
import { notify } from './notifications.js';

// Los trabajos de recordatorio heredan el tenant_id de su cita. El worker es
// único para toda la plataforma y procesa todas las barberías.

const reminderTypes = [['24H', '24 hours'], ['2H', '2 hours']];

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
         SELECT tenant_id, id, ?, ?, starts_at - interval '${interval}', 'PENDING', NULL, 0, NULL
         FROM appointments WHERE id = ? AND tenant_id = ? AND status = 'CONFIRMED'
         ON CONFLICT (appointment_id, channel, reminder_type) DO UPDATE SET scheduled_at = EXCLUDED.scheduled_at, status = 'PENDING', sent_at = NULL, attempts = 0, last_error = NULL`,
        [channel, type, appointmentId, tenantId]
      );
    }
  }
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
    const [lockRows] = await connection.execute("SELECT pg_try_advisory_lock(hashtext('empyrean-reminder-worker')) AS acquired");
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) return;
    const [jobs] = await connection.execute(
      `SELECT r.id, r.tenant_id AS "tenantId", r.appointment_id AS "appointmentId", r.channel, r.reminder_type AS "reminderType", r.attempts,
        a.starts_at AS "startsAt", a.payment_reference AS "paymentReference", s.name AS "serviceName", b.display_name AS "barberName",
        u.id AS "userId", u.first_name AS "firstName", u.email,
        COALESCE(bs.business_name, t.display_name) AS "businessName", bs.address, bs.city, bs.phone
       FROM reminder_jobs r JOIN appointments a ON a.id = r.appointment_id
       JOIN users u ON u.id = a.client_id JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
       LEFT JOIN tenant_settings bs ON bs.tenant_id = a.tenant_id
       JOIN tenants t ON t.id = a.tenant_id
       WHERE r.status = 'PENDING' AND r.scheduled_at <= now() AND a.status = 'CONFIRMED'
       AND t.status IN ('TRIAL', 'ACTIVE')
       AND (r.channel <> 'EMAIL' OR ? = 1)
       ORDER BY r.scheduled_at ASC LIMIT 100`, [Number(isEmailConfigured())]
    );
    for (const job of jobs) {
      try {
        if (job.channel === 'EMAIL') await sendAppointmentReminderEmail({ to: job.email, firstName: job.firstName, appointment: job, business: { businessName: job.businessName, address: job.address ?? '', city: job.city ?? '', phone: job.phone ?? '' } });
        if (job.channel === 'IN_APP') await notify(connection, { tenantId: job.tenantId, userId: job.userId, appointmentId: job.appointmentId, type: `REMINDER_${job.reminderType}`, title: `Recordatorio de cita (${job.reminderType})`, message: `Recuerda tu cita de ${job.serviceName} con ${job.barberName}.` });
        await connection.execute("UPDATE reminder_jobs SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ?", [job.id]);
      } catch (error) {
        await connection.execute("UPDATE reminder_jobs SET last_error = ?, status = CASE WHEN attempts >= 2 THEN 'FAILED' ELSE 'PENDING' END, scheduled_at = CASE WHEN attempts >= 2 THEN scheduled_at ELSE (now() + interval '5 minutes') END, attempts = attempts + 1 WHERE id = ?", [String(error.message).slice(0, 1000), job.id]);
      }
    }
  } finally {
    if (locked) await connection.execute("SELECT pg_advisory_unlock(hashtext('empyrean-reminder-worker'))").catch(() => {});
    connection.release();
  }
}

export function startReminderWorker() {
  processDueReminders().catch((error) => console.error('Error al procesar recordatorios:', error.message));
  const timer = setInterval(() => processDueReminders().catch((error) => console.error('Error al procesar recordatorios:', error.message)), 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
