import { unlink } from 'node:fs/promises';
import path from 'node:path';
import pool from '../config/database.js';
import { uploadsPath } from '../config/paths.js';

// Borra los comprobantes de pago con más de PAYMENT_PROOF_RETENTION_DAYS días
// (20 por defecto): la imagen del disco y su fila. Nunca toca los de citas que
// siguen pendientes de revisión. La cita conserva su estado, el monto y la
// referencia del pago; solo pierde el enlace a la imagen.
const DEFAULT_RETENTION_DAYS = 20;
const CLEANUP_BATCH = 500;
const proofsRoot = uploadsPath('payments');

export function retentionDays() {
  const days = Number(process.env.PAYMENT_PROOF_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  return Number.isInteger(days) && days >= 1 ? days : DEFAULT_RETENTION_DAYS;
}

// Devuelve cuántos comprobantes borró (como máximo CLEANUP_BATCH por llamada).
export async function deleteExpiredPaymentProofs() {
  const connection = await pool.getConnection();
  let expired = [];
  try {
    await connection.beginTransaction();
    // Si otra instancia ya está limpiando, esta no hace nada.
    const [lock] = await connection.execute("SELECT pg_try_advisory_xact_lock(hashtext('empyrean-payment-proof-cleanup')) AS acquired");
    if (!lock[0]?.acquired) {
      await connection.rollback();
      return 0;
    }
    [expired] = await connection.execute(
      `SELECT p.id, p.storage_key AS "storageKey"
       FROM payment_proofs p
       WHERE p.created_at < now() - make_interval(days => ?)
         AND NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.tenant_id = p.tenant_id AND a.status = 'PENDING'
             AND a.payment_proof_url LIKE ('%/payments/proofs/' || p.id::text)
         )
       ORDER BY p.created_at
       LIMIT ${CLEANUP_BATCH}
       FOR UPDATE OF p SKIP LOCKED`,
      [retentionDays()]
    );
    if (expired.length) {
      const ids = expired.map((proof) => proof.id);
      const placeholders = ids.map(() => '?').join(', ');
      await connection.execute(
        `UPDATE appointments SET payment_proof_url = NULL
         WHERE payment_proof_url IS NOT NULL AND right(payment_proof_url, 36) IN (${placeholders})`,
        ids
      );
      await connection.execute(`DELETE FROM payment_proofs WHERE id IN (${placeholders})`, ids);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // Los archivos se borran después de confirmar en la base: si algo falla antes,
  // la imagen sigue disponible.
  for (const proof of expired) {
    const file = path.resolve(proofsRoot, proof.storageKey);
    if (!file.startsWith(proofsRoot + path.sep)) continue;
    await unlink(file).catch((error) => {
      if (error.code !== 'ENOENT') console.error(`No se pudo borrar el archivo del comprobante ${proof.id}:`, error.message);
    });
  }
  if (expired.length) console.log(`Comprobantes de pago eliminados por antigüedad: ${expired.length}`);
  return expired.length;
}

async function cleanupExpiredPaymentProofs() {
  let deleted;
  do deleted = await deleteExpiredPaymentProofs(); while (deleted === CLEANUP_BATCH);
}

export function startPaymentProofCleanup() {
  const run = () => cleanupExpiredPaymentProofs().catch((error) => console.error('Error al borrar comprobantes vencidos:', error.message));
  // Primera pasada un minuto después de arrancar; luego una vez al día.
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, 24 * 60 * 60_000);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
