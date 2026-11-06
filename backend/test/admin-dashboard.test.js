import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pool from '../src/config/database.js';
import adminRouter from '../src/routes/admin.js';

const JWT_SECRET = 'phase-8-dashboard-secret';
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function adminToken(role = 'ADMINISTRADOR') {
  return jwt.sign({ sub: role === 'ADMINISTRADOR' ? '1' : '2', role }, JWT_SECRET, { expiresIn: '5m' });
}

const dashboardHandler = adminRouter.stack
  .find((layer) => layer.route?.path === '/dashboard')
  .route.stack[0].handle;
const dashboardHandlers = [
  adminRouter.stack[0].handle,
  adminRouter.stack[1].handle,
  dashboardHandler
];

function runDashboard(query, token) {
  return new Promise((resolve, reject) => {
    const request = {
      query,
      tenant: { id: TENANT_ID, slug: 'empyrean-studio' },
      get(header) {
        return header.toLowerCase() === 'cookie' ? `empyrean_session=${token}` : undefined;
      }
    };
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; }
    };
    let index = 0;
    const next = (error) => {
      if (error) return reject(error);
      const handler = dashboardHandlers[index++];
      if (!handler) return resolve({ status: response.statusCode, body: response.body });
      try {
        Promise.resolve(handler(request, response, next)).catch(reject);
      } catch (handlerError) {
        reject(handlerError);
      }
    };
    next();
  });
}

function dashboardRowsFor(sql) {
  if (sql.includes('COUNT(*) AS appointments')) {
    return [{
      appointments: 4, completed: 2, cancelled: 1, pending: 0, confirmed: 1,
      noShow: 0, confirmedRevenue: 210, completedRevenue: 140,
      occupiedMinutes: 180, recurringClients: 1
    }];
  }
  if (sql.includes('GROUP BY s.id, s.name')) return [{ name: 'Corte normal', total: 3 }];
  if (sql.includes("'%H:00') AS label")) return [{ label: '10:00', total: 2 }];
  if (sql.includes('GROUP BY a.status')) return [{ status: 'COMPLETED', total: 2 }];
  if (sql.includes('latest_days')) return [{ date: '2026-10-10', total: 2, completed: 1 }];
  if (sql.includes('GROUP BY b.id, b.display_name')) return [{ id: 2, name: 'Andy', total: 4, completed: 2, noShow: 0, revenue: 210, occupiedMinutes: 180 }];
  if (sql.includes('HAVING COUNT(*) > 1')) return [{ id: 5, name: 'Lian Linares', total: 3, lastVisit: '2026-10-10 14:00:00' }];
  throw new Error(`Consulta no contemplada en la prueba: ${sql}`);
}

test('el dashboard aplica filtros, protege los datos y no necesita una base real', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalExecute = pool.execute;
  const calls = [];
  process.env.JWT_SECRET = JWT_SECRET;
  pool.execute = async (sql, values = []) => {
    // requireAuth confirma la cuenta y su rol vigente; no cuenta como consulta del panel.
    if (sql.includes('FROM users u JOIN roles r')) return [[{ isActive: 1, role: values[0] === '1' ? 'ADMINISTRADOR' : 'CLIENTE' }]];
    // El usuario 1 es OWNER de la barbería; el 2 no tiene membresía en ella.
    if (sql.includes('FROM tenant_memberships')) return [values[0] === TENANT_ID && values[1] === '1' ? [{ role: 'OWNER' }] : []];
    calls.push({ sql, values });
    return [dashboardRowsFor(sql)];
  };

  try {
    const forbidden = await runDashboard({}, adminToken('CLIENTE'));
    assert.equal(forbidden.status, 403);
    assert.equal(calls.length, 0);

    const invalid = await runDashboard({ barberId: 'no-es-numero' }, adminToken());
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 0);

    const result = await runDashboard({ dateFrom: '2026-10-01', dateTo: '2026-10-31', barberId: '2', serviceId: '3' }, adminToken());
    assert.equal(result.status, 200);
    const { body } = result;
    assert.equal(body.metrics.appointments, 4);
    assert.deepEqual(body.serviceUsage, [{ name: 'Corte normal', total: 3 }]);
    assert.deepEqual(body.busyHours, [{ label: '10:00', total: 2 }]);
    assert.deepEqual(body.barberPerformance, [{ id: 2, name: 'Andy', total: 4, completed: 2, noShow: 0, revenue: 210, occupiedMinutes: 180 }]);
    assert.equal(calls.length, 7);
    // Horas y días se agrupan en hora local, no en UTC.
    const localGrouping = calls.filter((call) => call.sql.includes("'%H:00') AS label") || call.sql.includes('latest_days'));
    assert.equal(localGrouping.length, 2);
    for (const call of localGrouping) assert.ok(call.sql.includes("CONVERT_TZ(a.starts_at, '+00:00', '-04:00')"));

    // Días de Cochabamba (UTC-4): del 1 de octubre 00:00 local al 1 de noviembre 00:00 local.
    const filterValues = [TENANT_ID, '2026-10-01 04:00:00', '2026-11-01 04:00:00', 2, 3];
    assert.deepEqual(calls[0].values, [...filterValues, ...filterValues]);
    for (const call of calls.slice(1)) assert.deepEqual(call.values, filterValues);
    for (const call of calls) {
      assert.match(call.sql, /a\.tenant_id = \?/);
      assert.match(call.sql, /a\.starts_at >= \?/);
      assert.match(call.sql, /a\.barber_id = \?/);
      assert.match(call.sql, /a\.service_id = \?/);
    }
  } finally {
    pool.execute = originalExecute;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
