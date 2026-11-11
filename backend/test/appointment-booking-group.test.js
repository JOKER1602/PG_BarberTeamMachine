import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pool from '../src/config/database.js';
import { requireAuth } from '../src/middleware/auth.js';
import appointmentsRouter from '../src/routes/appointments.js';
import { zonedParts } from '../src/config/time.js';

const JWT_SECRET = 'booking-group-test-secret';
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function routeHandler(path, method) {
  return appointmentsRouter.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
}

function run(handler, { params, body, role = 'CLIENTE', sub = '5' }) {
  const token = jwt.sign({ sub, role }, JWT_SECRET, { expiresIn: '5m' });
  return new Promise((resolve, reject) => {
    const request = {
      params,
      body,
      tenant: { id: TENANT_ID, slug: 'empyrean-studio' },
      get: (header) => (header.toLowerCase() === 'cookie' ? `empyrean_session=${token}` : undefined)
    };
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    requireAuth(request, response, () => {
      Promise.resolve(handler(request, response, reject)).catch(reject);
    });
  });
}

function fakeConnection(answer) {
  const calls = [];
  return {
    calls,
    async beginTransaction() {},
    async commit() { calls.push({ sql: 'COMMIT' }); },
    async rollback() { calls.push({ sql: 'ROLLBACK' }); },
    release() {},
    async execute(sql, values = []) {
      calls.push({ sql, values });
      return [answer(sql, values) ?? { affectedRows: 1 }];
    }
  };
}

async function withConnection(connection, callback) {
  const previousSecret = process.env.JWT_SECRET;
  const originalGetConnection = pool.getConnection;
  const originalExecute = pool.execute;
  process.env.JWT_SECRET = JWT_SECRET;
  pool.getConnection = async () => connection;
  // requireAuth confirma que la cuenta siga activa y lee su rol vigente.
  pool.execute = async () => [[{ isActive: 1, role: 'CLIENTE' }]];
  try {
    return await callback();
  } finally {
    pool.getConnection = originalGetConnection;
    pool.execute = originalExecute;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

test('el cliente cancela completa una reserva confirmada de varios servicios', async () => {
  const connection = fakeConnection((sql) => {
    if (sql.includes('SELECT client_id AS "clientId", payment_reference')) return [{ clientId: 5, paymentReference: 'ref-1' }];
    if (sql.includes('SELECT id FROM appointments') && sql.includes('payment_reference = ?')) return [{ id: 10 }, { id: 11 }];
    return undefined;
  });

  const result = await withConnection(connection, () => run(routeHandler('/:id/cancel', 'patch'), { params: { id: '10' }, body: {} }));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.cancelledIds, [10, 11]);
  const lookup = connection.calls.find((call) => call.sql.includes('SELECT id FROM appointments') && call.sql.includes('payment_reference = ?'));
  assert.match(lookup.sql, /status IN \('PENDING', 'CONFIRMED'\)/);
  const update = connection.calls.find((call) => call.sql.includes("SET status = 'CANCELLED'"));
  assert.deepEqual(update.values.slice(-2), [10, 11]);
  const reminderCancellations = connection.calls.filter((call) => call.sql.includes('UPDATE reminder_jobs'));
  assert.deepEqual(reminderCancellations.map((call) => call.values[0]), [10, 11]);
  assert.ok(connection.calls.some((call) => call.sql === 'COMMIT'));
});

test('reprogramar mueve todos los servicios de la reserva en cadena', async () => {
  const newStart = '2030-03-13T10:00:00-04:00';
  const weekday = zonedParts(newStart).weekday;
  const connection = fakeConnection((sql) => {
    if (sql.includes('SELECT id, client_id AS "clientId", barber_id AS "barberId"')) {
      return [{ id: 10, clientId: 5, barberId: 2, serviceId: 1, status: 'CONFIRMED', paymentReference: 'ref-1' }];
    }
        if (sql.includes('s.duration_minutes AS "durationMinutes"') && sql.includes('a.payment_reference = ?')) {
      return [{ id: 10, serviceId: 1, durationMinutes: 30 }, { id: 11, serviceId: 3, durationMinutes: 20 }];
    }
    if (sql.includes('JOIN barber_services bs')) return [{ id: 1, durationMinutes: 30, price: 50 }];
    if (sql.includes('FROM barber_working_hours')) return [{ weekday, start_minutes: 9 * 60, end_minutes: 20 * 60 }];
    if (sql.includes('FROM schedule_blocks')) return [];
    // Las citas actuales de la misma reserva se solapan con el nuevo horario,
    // pero no deben bloquearlo porque son las que se están moviendo.
    if (sql.includes('SELECT id, starts_at, ends_at FROM appointments')) {
      return [
        { id: 10, starts_at: new Date('2030-03-13T14:10:00Z'), ends_at: new Date('2030-03-13T14:40:00Z') },
        { id: 11, starts_at: new Date('2030-03-13T14:40:00Z'), ends_at: new Date('2030-03-13T15:00:00Z') }
      ];
    }
    return undefined;
  });

  const result = await withConnection(connection, () => run(routeHandler('/:id/reschedule', 'patch'), { params: { id: '10' }, body: { startsAt: newStart } }));

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.rescheduledIds, [10, 11]);
  const updates = connection.calls.filter((call) => call.sql.includes('UPDATE appointments SET starts_at'));
  assert.deepEqual(updates.map((call) => call.values), [
    ['2030-03-13T14:00:00.000Z', '2030-03-13T14:30:00.000Z', 'CONFIRMED', '5', 10, TENANT_ID],
    ['2030-03-13T14:30:00.000Z', '2030-03-13T14:50:00.000Z', 'CONFIRMED', '5', 11, TENANT_ID]
  ]);
});

test('reprogramar rechaza el horario si otra cita ajena ocupa la cadena completa', async () => {
  const newStart = '2030-03-13T10:00:00-04:00';
  const weekday = zonedParts(newStart).weekday;
  const connection = fakeConnection((sql) => {
    if (sql.includes('SELECT id, client_id AS "clientId", barber_id AS "barberId"')) {
      return [{ id: 10, clientId: 5, barberId: 2, serviceId: 1, status: 'CONFIRMED', paymentReference: 'ref-1' }];
    }
        if (sql.includes('s.duration_minutes AS "durationMinutes"') && sql.includes('a.payment_reference = ?')) {
      return [{ id: 10, serviceId: 1, durationMinutes: 30 }, { id: 11, serviceId: 3, durationMinutes: 20 }];
    }
    if (sql.includes('JOIN barber_services bs')) return [{ id: 1, durationMinutes: 30, price: 50 }];
    if (sql.includes('FROM barber_working_hours')) return [{ weekday, start_minutes: 9 * 60, end_minutes: 20 * 60 }];
    if (sql.includes('FROM schedule_blocks')) return [];
    // Otra cita empieza a los 40 minutos: cabe el primer servicio, no el segundo.
    if (sql.includes('SELECT id, starts_at, ends_at FROM appointments')) {
      return [{ id: 99, starts_at: new Date('2030-03-13T14:40:00Z'), ends_at: new Date('2030-03-13T15:10:00Z') }];
    }
    return undefined;
  });

  const result = await withConnection(connection, () => run(routeHandler('/:id/reschedule', 'patch'), { params: { id: '10' }, body: { startsAt: newStart } }));

  assert.equal(result.status, 409);
  assert.equal(connection.calls.filter((call) => call.sql.includes('UPDATE appointments SET starts_at')).length, 0);
});
