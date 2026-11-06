import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/database.js';
import servicesRouter from '../src/routes/services.js';
import barbersRouter from '../src/routes/barbers.js';
import settingsRouter from '../src/routes/settings.js';

// Guardia estructural del Incremento 2: cada consulta de un módulo aislado debe
// filtrar por el tenant de la URL. Se ejecuta cada ruta con la barbería A y un
// cuerpo que intenta inyectar el id de la barbería B.
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const TENANT_TABLES = /\b(services|service_categories|barbers|barber_services|barber_working_hours|schedule_blocks|tenant_settings|appointments|tenant_memberships)\b/;
const injected = { tenantId: TENANT_B, tenant_id: TENANT_B };
const future = new Date(Date.now() + 7 * 86_400_000);

const settingsBody = { businessName: 'Barbería A', address: 'Calle 1', city: 'Cochabamba', country: 'Bolivia', phone: '7000000', whatsapp: '7000000', hoursText: 'Lunes a sábado' };
const routes = [
  [servicesRouter, 'get', '/categories'],
  [servicesRouter, 'post', '/categories', { body: { name: 'Cortes', slug: 'cortes' } }],
  [servicesRouter, 'get', '/'],
  [servicesRouter, 'get', '/admin'],
  [servicesRouter, 'post', '/', { body: { name: 'Corte', price: 50, durationMinutes: 30, categoryId: 1 } }],
  [servicesRouter, 'patch', '/:id', { params: { id: '7' }, body: { price: 60, categoryId: 1 } }],
  [servicesRouter, 'delete', '/:id', { params: { id: '7' } }],
  [barbersRouter, 'get', '/'],
  [barbersRouter, 'get', '/admin'],
  [barbersRouter, 'post', '/', { body: { displayName: 'Beto' } }],
  [barbersRouter, 'patch', '/:id', { params: { id: '4' }, body: { isActive: false } }],
  [barbersRouter, 'post', '/:id/photo', { params: { id: '4' }, file: { filename: 'barber-x.png' } }],
  [barbersRouter, 'put', '/:id/services', { params: { id: '4' }, body: { serviceIds: [1] } }],
  [barbersRouter, 'get', '/:id/working-hours', { params: { id: '4' } }],
  [barbersRouter, 'post', '/:id/working-hours', { params: { id: '4' }, body: { weekday: 1, startTime: '10:00', endTime: '19:00' } }],
  [barbersRouter, 'delete', '/:id/working-hours/:workingHourId', { params: { id: '4', workingHourId: '2' } }],
  [barbersRouter, 'get', '/:id/blocks', { params: { id: '4' } }],
  [barbersRouter, 'post', '/:id/blocks', { params: { id: '4' }, body: { startsAt: future.toISOString(), endsAt: new Date(future.getTime() + 3_600_000).toISOString() } }],
  [barbersRouter, 'delete', '/:id/blocks/:blockId', { params: { id: '4', blockId: '3' } }],
  [settingsRouter, 'get', '/'],
  [settingsRouter, 'patch', '/', { body: settingsBody }],
  [settingsRouter, 'post', '/payment-qr', { file: { filename: 'qr-x.png' } }]
];

function fakeResult(sql) {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) return { affectedRows: 1, insertId: 1 };
  if (sql.includes('COUNT(*) AS total')) return [{ total: 0 }];
  if (sql.includes('FROM appointments')) return [];
  if (sql.includes('FROM barbers WHERE id = ? AND tenant_id = ? FOR UPDATE')) return [{ userId: 30, isActive: 1 }];
  return [{ id: 1 }];
}

async function runRoute(router, method, path, { params = {}, body, file } = {}) {
  const handler = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
  const calls = [];
  const execute = async (sql, values = []) => { calls.push({ sql, values }); return [fakeResult(sql)]; };
  const connection = { execute, query: execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  const original = { execute: pool.execute, query: pool.query, getConnection: pool.getConnection };
  Object.assign(pool, { execute, query: execute, getConnection: async () => connection });
  try {
    const status = await new Promise((resolve, reject) => {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json() { resolve(this.statusCode); return this; },
        send() { resolve(this.statusCode); return this; }
      };
      const request = {
        params, file, query: { ...injected }, headers: { 'x-tenant-id': TENANT_B },
        body: body ? { ...body, ...injected } : undefined,
        tenant: { id: TENANT_A, slug: 'barberia-a' }, auth: { sub: '10' },
        protocol: 'http', get: () => 'localhost'
      };
      Promise.resolve(handler(request, response, reject)).catch(reject);
    });
    return { status, calls };
  } finally {
    Object.assign(pool, original);
  }
}

for (const [router, method, path, options] of routes) {
  const name = `${router === servicesRouter ? 'services' : router === barbersRouter ? 'barbers' : 'settings'} ${method.toUpperCase()} ${path}`;
  test(`aislamiento: ${name} filtra todas sus consultas por el tenant de la URL`, async () => {
    const { status, calls } = await runRoute(router, method, path, options);
    assert.ok(status < 400, `la ruta respondió ${status}`);
    const tenantStatements = calls.filter((call) => TENANT_TABLES.test(call.sql));
    assert.ok(tenantStatements.length > 0, 'la ruta no consultó datos de la barbería');
    for (const call of tenantStatements) {
      assert.match(call.sql, /tenant_id/, `consulta sin tenant_id: ${call.sql}`);
      assert.ok(call.values.includes(TENANT_A), `consulta sin el tenant de la URL: ${call.sql}`);
    }
    for (const call of calls) {
      assert.ok(!call.values.includes(TENANT_B), `se usó el tenant enviado por el navegador: ${call.sql}`);
    }
  });
}

test('cada ruta de los módulos aislados está cubierta por la guardia', () => {
  const declared = [servicesRouter, barbersRouter, settingsRouter].flatMap((router) => router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method} ${layer.route.path}`))
    .map((route) => `${router === servicesRouter ? 's' : router === barbersRouter ? 'b' : 'c'} ${route}`));
  const covered = routes.map(([router, method, path]) => `${router === servicesRouter ? 's' : router === barbersRouter ? 'b' : 'c'} ${method} ${path}`);
  assert.deepEqual([...declared].sort(), [...covered].sort(), 'agrega a esta prueba toda ruta nueva de services, barbers o settings');
});
