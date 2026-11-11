import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/database.js';
import barbersRouter from '../src/routes/barbers.js';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const patchBarber = barbersRouter.stack
  .find((layer) => layer.route?.path === '/:id' && layer.route.methods.patch)
  .route.stack.at(-1).handle;

function run(upcomingAppointments) {
  const calls = [];
  const connection = {
    async beginTransaction() {},
    async commit() { calls.push({ sql: 'COMMIT' }); },
    async rollback() { calls.push({ sql: 'ROLLBACK' }); },
    release() {},
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM barbers WHERE id = ? AND tenant_id = ? FOR UPDATE')) return [[{ userId: 30, isActive: 1 }]];
      if (sql.includes('COUNT(*) AS total FROM appointments')) return [[{ total: upcomingAppointments }]];
      return [{ affectedRows: 1 }];
    }
  };
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => connection;
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, calls }); return this; }
    };
    const request = { params: { id: '4' }, body: { isActive: false }, tenant: { id: TENANT_ID } };
    Promise.resolve(patchBarber(request, response, reject)).catch(reject);
  }).finally(() => { pool.getConnection = originalGetConnection; });
}

test('no desactiva a un profesional que aún tiene citas por atender', async () => {
  const result = await run(2);
  assert.equal(result.status, 409);
  assert.equal(result.body.upcomingAppointments, 2);
  assert.ok(result.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!result.calls.some((call) => call.sql.startsWith('UPDATE')));
});

test('desactiva al profesional, su membresía y su cuenta si no trabaja en otra barbería', async () => {
  const result = await run(0);
  assert.equal(result.status, 200);
  const barberUpdate = result.calls.find((call) => call.sql.startsWith('UPDATE barbers SET is_active'));
  assert.deepEqual(barberUpdate.values, [false, 4, TENANT_ID]);
  const membership = result.calls.find((call) => call.sql.startsWith('UPDATE tenant_memberships'));
  assert.deepEqual(membership.values, [false, TENANT_ID, 30]);
  const account = result.calls.find((call) => call.sql.startsWith('UPDATE users'));
  assert.match(account.sql, /NOT EXISTS/, 'la cuenta global solo se bloquea sin otras membresías activas');
  assert.deepEqual(account.values, [false, 30, TENANT_ID]);
  assert.ok(result.calls.some((call) => call.sql === 'COMMIT'));
});
