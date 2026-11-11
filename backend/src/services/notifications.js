// Única forma de crear notificaciones internas: exige el tenant para que una
// notificación nunca quede sin barbería (tenant_id es obligatorio desde 014).
export async function notify(executor, { tenantId, userId, appointmentId = null, type, title, message }) {
  if (!tenantId) throw new Error('notify requiere tenantId');
  await executor.execute(
    'INSERT INTO notifications (tenant_id, user_id, appointment_id, type, title, message) VALUES (?, ?, ?, ?, ?, ?)',
    [tenantId, userId, appointmentId, type, title, message]
  );
}
