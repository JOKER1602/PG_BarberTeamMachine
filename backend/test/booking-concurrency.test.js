import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/database.js';
import appointmentsRouter from '../src/routes/appointments.js';
import { retryOnDeadlock } from '../src/middleware/retry-deadlock.js';

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';
const handlerOf = (path, method) => appointmentsRouter.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;

function fakeResponse(resolve) {
  return { statusCode: 200, headersSent: false, status(code) { this.statusCode = code; return this; }, json(body) { this.headersSent = true; resolve?.({ status: this.statusCode, body }); return this; } };
}

// Las validaciones previas (sin conexión propia ni candado) son solo un filtro
// rápido. Lo que garantiza que no haya citas solapadas ni comprobantes usados
// dos veces debe ocurrir DENTRO de la transacción y DESPUÉS del candado del
// barbero; y lo leído dentro de la transacción antes del candado, con bloqueo.
function fake(sql) {
  if (sql.includes('pg_advisory_xact_lock') || /^\s*SET LOCAL/i.test(sql)) return [[]];
  if (/^\s*UPDATE payment_proofs/i.test(sql)) return [{ affectedRows: 1, rows: [{ id: 'p' }] }];
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) return [{ affectedRows: 1, insertId: 1, rows: [{ id: 1 }] }];
  if (sql.includes('FROM payment_proofs')) return [[{ id: 'p' }]];
  if (sql.includes('SELECT barber_id AS "barberId" FROM appointments')) return [[{ barberId: 2 }]];
  if (sql.includes('client_id AS "clientId", barber_id AS "barberId"')) return [[{ id: 10, clientId: 5, barberId: 2, serviceId: 1, status: 'CONFIRMED', paymentReference: 'r' }]];
  if (sql.includes('a.service_id AS "serviceId", s.duration_minutes')) return [[{ id: 10, serviceId: 1, durationMinutes: 30 }]];
  if (sql.includes('duration_minutes AS "durationMinutes"')) return [[{ id: 1, durationMinutes: 30, price: 50 }]];
  if (sql.includes('FROM barber_working_hours')) return [[{ weekday: 3, start_minutes: 0, end_minutes: 1439 }]];
  return [[]];
}

async function traceRoute(path, method, request) {
  const transaction = []; const outside = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    async execute(sql) { transaction.push(sql); return fake(sql); }
  };
  const original = { execute: pool.execute, getConnection: pool.getConnection };
  Object.assign(pool, { execute: async (sql) => { outside.push(sql); return fake(sql); }, getConnection: async () => connection });
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      Promise.resolve(handlerOf(path, method)({ tenant: { id: TENANT, slug: 'a' }, auth: { sub: '5' }, membership: null, ...request }, fakeResponse(resolve), reject)).catch(reject);
    });
  } finally { Object.assign(pool, original); }
  return { result, transaction, outside };
}

const startsAt = '2030-03-13T14:00:00.000Z';
const overlapRead = (sql) => sql.includes('SELECT id, starts_at, ends_at FROM appointments');
for (const [name, path, method, request, okStatus] of [
  ['reprogramar', '/:id/reschedule', 'patch', { params: { id: '10' }, body: { startsAt } }, 200],
  ['reservar', '/multi', 'post', { body: { barberId: 2, serviceIds: [1], startsAt, paymentProofId: '11111111-1111-4111-8111-111111111111' } }, 201]
]) {
  test(`${name}: la revisión de solapes ocurre dentro de la transacción y después del candado`, async () => {
    const { result, transaction } = await traceRoute(path, method, request);
    assert.equal(result.status, okStatus, JSON.stringify(result.body));
    const lockAt = transaction.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
    assert.ok(lockAt >= 0, 'la ruta debe tomar el candado del barbero');
    const overlapAt = transaction.findIndex(overlapRead);
    assert.ok(overlapAt > lockAt, 'los solapes deben leerse con el candado tomado');
    for (const sql of transaction.slice(0, lockAt).filter((s) => /^\s*SELECT/i.test(s))) assert.match(sql, /FOR UPDATE/, `lectura sin bloqueo antes del candado: ${sql}`);
    const writeAt = transaction.findIndex((sql) => /^\s*(INSERT INTO appointments|UPDATE appointments)/i.test(sql));
    assert.ok(writeAt > overlapAt, 'la cita se escribe después de revisar los solapes');
  });
}

test('reservar: el comprobante se reclama con el candado tomado y en la misma transacción', async () => {
  const { transaction, outside } = await traceRoute('/multi', 'post', { body: { barberId: 2, serviceIds: [1], startsAt, paymentProofId: '11111111-1111-4111-8111-111111111111' } });
  const lockAt = transaction.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const claimAt = transaction.findIndex((sql) => /UPDATE payment_proofs SET used_at = now\(\)[\s\S]*used_at IS NULL RETURNING id/.test(sql));
  assert.ok(claimAt > lockAt, 'el comprobante se marca como usado tras el candado');
  assert.ok(!outside.some((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), 'las validaciones previas no escriben');
});

test('reservar: un horario ya ocupado se rechaza antes de pedir turno ni conexión', async () => {
  const transaction = [];
  const original = { execute: pool.execute, getConnection: pool.getConnection };
  Object.assign(pool, {
    execute: async (sql) => (overlapRead(sql) ? [[{ id: 99, starts_at: new Date(startsAt), ends_at: new Date(Date.parse(startsAt) + 3_600_000) }]] : fake(sql)),
    getConnection: async () => { transaction.push('conexión'); return null; }
  });
  try {
    const result = await new Promise((resolve, reject) => {
      Promise.resolve(handlerOf('/multi', 'post')({ tenant: { id: TENANT, slug: 'a' }, auth: { sub: '5' }, membership: null, body: { barberId: 2, serviceIds: [1], startsAt, paymentProofId: '11111111-1111-4111-8111-111111111111' } }, fakeResponse(resolve), reject)).catch(reject);
    });
    assert.equal(result.status, 409);
    assert.deepEqual(transaction, [], 'no debe pedir conexión');
  } finally { Object.assign(pool, original); }
});

const deadlock = () => Object.assign(new Error('Deadlock found'), { code: '40P01' });

function runRetry(handler, options = { baseDelayMs: 1 }) {
  const response = fakeResponse();
  return new Promise((resolve, reject) => {
    retryOnDeadlock(handler, options)({}, response, (error) => resolve({ forwarded: error, response })).then(() => resolve({ response })).catch(reject);
  });
}

test('un deadlock se reintenta y la petición termina bien', async () => {
  let runs = 0;
  const { forwarded, response } = await runRetry(async (_request, res, next) => {
    runs += 1;
    if (runs < 3) return next(deadlock());
    return res.status(200).json({ ok: true });
  });
  assert.equal(runs, 3);
  assert.equal(forwarded, undefined);
  assert.equal(response.statusCode, 200);
});

test('se rinde tras los intentos permitidos e informa el error', async () => {
  let runs = 0;
  const { forwarded } = await runRetry(async (_request, _response, next) => { runs += 1; return next(deadlock()); });
  assert.equal(runs, 3);
  assert.equal(forwarded.code, '40P01');
});

test('otros errores no se reintentan', async () => {
  let runs = 0;
  const { forwarded } = await runRetry(async (_request, _response, next) => { runs += 1; return next(new Error('otro')); });
  assert.equal(runs, 1);
  assert.equal(forwarded.message, 'otro');
});

test('no reintenta si la respuesta ya se envió', async () => {
  let runs = 0;
  const { forwarded } = await runRetry(async (_request, response, next) => { runs += 1; response.headersSent = true; return next(deadlock()); });
  assert.equal(runs, 1);
  assert.equal(forwarded.code, '40P01');
});

test('una excepción de la ruta llega al manejador de errores', async () => {
  const { forwarded } = await runRetry(async () => { throw new Error('rechazo'); });
  assert.equal(forwarded.message, 'rechazo');
});
