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

// Bajo REPEATABLE READ, la primera lectura normal fija la "foto" de la
// transacción. Si ocurre antes de GET_LOCK, la disponibilidad no ve las citas
// que otra petición guardó mientras se esperaba el turno: citas duplicadas.
async function statementsBeforeLock(path, method, request) {
  const calls = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 0 }]]; // corta la ruta justo al llegar al candado
      if (sql.includes('FROM payment_proofs')) return [[{ id: 'p' }]];
      if (sql.includes('client_id AS clientId, barber_id AS barberId')) return [[{ id: 10, clientId: 5, barberId: 2, serviceId: 1, status: 'CONFIRMED', paymentReference: 'r' }]];
      return [[]];
    }
  };
  const original = pool.getConnection;
  pool.getConnection = async () => connection;
  try {
    await new Promise((resolve, reject) => {
      Promise.resolve(handlerOf(path, method)({ tenant: { id: TENANT, slug: 'a' }, auth: { sub: '5' }, membership: null, ...request }, fakeResponse(resolve), reject)).catch(reject);
    });
  } finally { pool.getConnection = original; }
  const lockAt = calls.findIndex((sql) => sql.includes('GET_LOCK'));
  assert.ok(lockAt >= 0, 'la ruta debe tomar el candado del barbero');
  return calls.slice(0, lockAt);
}

const startsAt = '2030-03-13T14:00:00.000Z';
for (const [name, path, method, request] of [
  ['reprogramar', '/:id/reschedule', 'patch', { params: { id: '10' }, body: { startsAt } }],
  ['reservar', '/multi', 'post', { body: { barberId: 2, serviceIds: [1], startsAt, paymentProofId: '11111111-1111-4111-8111-111111111111' } }]
]) {
  test(`${name}: toda lectura antes del candado del barbero es con bloqueo (FOR UPDATE)`, async () => {
    const before = await statementsBeforeLock(path, method, request);
    assert.ok(before.length > 0);
    for (const sql of before) assert.match(sql, /FOR UPDATE/, `lectura sin bloqueo antes del candado: ${sql}`);
  });
}

const deadlock = () => Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });

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
  assert.equal(forwarded.code, 'ER_LOCK_DEADLOCK');
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
  assert.equal(forwarded.code, 'ER_LOCK_DEADLOCK');
});

test('una excepción de la ruta llega al manejador de errores', async () => {
  const { forwarded } = await runRetry(async () => { throw new Error('rechazo'); });
  assert.equal(forwarded.message, 'rechazo');
});
