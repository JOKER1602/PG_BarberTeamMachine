// Fila en memoria por barbero: las reservas y reprogramaciones de un mismo
// barbero se atienden de a una dentro de esta instancia, y esperan su turno SIN
// ocupar una conexión a la base. Así un pico de reservas no agota las pocas
// conexiones que da el pooler (unas 15 en el plan Micro de Supabase).
//
// El candado de la base (pg_advisory_xact_lock) sigue siendo la garantía entre
// varias instancias; esta fila solo evita que las esperas consuman conexiones.

const tails = new Map();

export class BarberQueueTimeout extends Error {
  constructor() {
    super('Hay muchas reservas en curso para este barbero');
    this.code = 'BARBER_QUEUE_TIMEOUT';
  }
}

export async function withBarberQueue(barberId, task, { timeoutMs = 15_000 } = {}) {
  const key = String(barberId);
  const previous = tails.get(key) ?? Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  // El siguiente espera a que terminen el anterior Y este, aunque este se rinda.
  const tail = previous.then(() => mine);
  tails.set(key, tail);

  let timer;
  const gotTurn = await Promise.race([
    previous.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })
  ]);
  clearTimeout(timer);
  try {
    if (!gotTurn) throw new BarberQueueTimeout();
    return await task();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

// Solo para pruebas: cuántos barberos tienen fila abierta.
export const openQueues = () => tails.size;
