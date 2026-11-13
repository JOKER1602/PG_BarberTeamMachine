// Reglas comunes para marcar citas como atendidas o no asistidas.
//
// - Solo se puede marcar «Atendida» o «No asistió» desde la hora de inicio de
//   la cita (no tiene sentido registrar una inasistencia antes de tiempo).
// - Cada cambio queda en appointment_status_changes.
// - El barbero puede deshacer su propio cambio durante UNDO_WINDOW_MINUTES.
// - Después, solo el dueño o administrador lo corrige, con motivo obligatorio.

export const UNDO_WINDOW_MINUTES = 10;
export const ATTENDANCE_STATUSES = ['COMPLETED', 'NO_SHOW'];

export const NOT_STARTED_MESSAGE = 'Solo puedes marcar la asistencia desde la hora de inicio de la cita.';

export async function recordStatusChange(executor, { tenantId, appointmentId, fromStatus, toStatus, changedBy, kind = 'CHANGE', reason = null }) {
  if (!tenantId) throw new Error('recordStatusChange requiere tenantId');
  await executor.execute(
    `INSERT INTO appointment_status_changes (tenant_id, appointment_id, from_status, to_status, kind, reason, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, appointmentId, fromStatus, toStatus, kind, reason, changedBy]
  );
}

// Último cambio de la cita si todavía se puede deshacer por este usuario:
// fue un cambio normal suyo a Atendida/No asistió hace menos de la ventana y
// la cita sigue en ese estado. Devuelve la fila o null.
export async function findUndoableChange(executor, { tenantId, appointmentId, userId, currentStatus }) {
  const [rows] = await executor.execute(
    `SELECT id, from_status AS "fromStatus", to_status AS "toStatus", kind, changed_by AS "changedBy",
            created_at > now() - interval '${UNDO_WINDOW_MINUTES} minutes' AS "withinWindow"
     FROM appointment_status_changes
     WHERE tenant_id = ? AND appointment_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [tenantId, appointmentId]
  );
  const last = rows[0];
  if (!last) return null;
  const undoable = last.kind === 'CHANGE' && String(last.changedBy) === String(userId) && last.toStatus === currentStatus
    && ATTENDANCE_STATUSES.includes(last.toStatus) && Boolean(last.withinWindow);
  return undoable ? last : null;
}

// Expresión SQL para el listado del barbero: hasta cuándo puede deshacer
// el último cambio de cada cita (NULL si ya no puede). Usa los alias a.* de la
// consulta y espera como parámetros, en orden, el tenant y el id del usuario.
export const UNDO_UNTIL_SQL = `(
  SELECT c.created_at + interval '${UNDO_WINDOW_MINUTES} minutes'
  FROM (
    SELECT c0.created_at, c0.kind, c0.changed_by, c0.to_status
    FROM appointment_status_changes c0
    WHERE c0.tenant_id = ? AND c0.appointment_id = a.id
    ORDER BY c0.created_at DESC, c0.id DESC LIMIT 1
  ) c
  WHERE c.kind = 'CHANGE' AND c.changed_by = ? AND c.to_status = a.status
    AND c.to_status IN ('COMPLETED', 'NO_SHOW')
    AND c.created_at > now() - interval '${UNDO_WINDOW_MINUTES} minutes'
)`;
