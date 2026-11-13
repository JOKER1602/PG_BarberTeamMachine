import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pool from '../src/config/database.js';
import { TENANT_MODULE_PATHS } from '../src/app.js';
import servicesRouter from '../src/routes/services.js';
import barbersRouter from '../src/routes/barbers.js';
import settingsRouter from '../src/routes/settings.js';
import adminRouter from '../src/routes/admin.js';
import barberPortalRouter from '../src/routes/barber-portal.js';
import appointmentsRouter from '../src/routes/appointments.js';
import paymentsRouter from '../src/routes/payments.js';
import reviewsRouter from '../src/routes/reviews.js';
import notificationsRouter from '../src/routes/notifications.js';
import recommendationsRouter from '../src/routes/recommendations.js';

// Guardia estructural del aislamiento multiempresa: cada ruta de cada módulo
// de negocio se ejecuta con la barbería A y una petición que intenta inyectar
// el id de la barbería B (cuerpo, query y cabeceras). Falla si alguna consulta
// a datos de una barbería no filtra por el tenant de la URL, si usa el tenant
// del navegador, o si existe una ruta que esta prueba no cubre.
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const TENANT_TABLES = /\b(services|service_categories|barbers|barber_services|barber_working_hours|schedule_blocks|tenant_settings|appointments|tenant_memberships|notifications|payment_proofs|reviews|reminder_jobs|appointment_status_changes)\b/;
const injected = { tenantId: TENANT_B, tenant_id: TENANT_B };
const future = new Date(Date.now() + 7 * 86_400_000);
const futureStart = '2030-03-13T10:00:00-04:00';

const modules = {
  services: servicesRouter, barbers: barbersRouter, settings: settingsRouter, admin: adminRouter,
  barber: barberPortalRouter, appointments: appointmentsRouter, payments: paymentsRouter, reviews: reviewsRouter,
  notifications: notificationsRouter, recommendations: recommendationsRouter
};

const settingsBody = { businessName: 'Barbería A', address: 'Calle 1', city: 'Cochabamba', country: 'Bolivia', phone: '7000000', whatsapp: '7000000', hoursText: 'Lunes a sábado' };
const proofsDir = path.resolve(process.cwd(), 'uploads', 'payments');
const routes = [
  ['services', 'get', '/categories'],
  ['services', 'post', '/categories', { body: { name: 'Cortes', slug: 'cortes' } }],
  ['services', 'get', '/'],
  ['services', 'get', '/admin'],
  ['services', 'post', '/', { body: { name: 'Corte', price: 50, durationMinutes: 30, categoryId: 1 } }],
  ['services', 'patch', '/:id', { params: { id: '7' }, body: { price: 60, categoryId: 1 } }],
  ['services', 'delete', '/:id', { params: { id: '7' } }],
  ['barbers', 'get', '/'],
  ['barbers', 'get', '/admin'],
  ['barbers', 'post', '/', { body: { displayName: 'Beto' } }],
  ['barbers', 'patch', '/:id', { params: { id: '4' }, body: { isActive: false } }],
  ['barbers', 'post', '/:id/photo', { params: { id: '4' }, file: { filename: 'barber-x.png' } }],
  ['barbers', 'put', '/:id/services', { params: { id: '4' }, body: { serviceIds: [1] } }],
  ['barbers', 'get', '/:id/working-hours', { params: { id: '4' } }],
  ['barbers', 'post', '/:id/working-hours', { params: { id: '4' }, body: { weekday: 1, startTime: '10:00', endTime: '19:00' } }],
  ['barbers', 'delete', '/:id/working-hours/:workingHourId', { params: { id: '4', workingHourId: '2' } }],
  ['barbers', 'get', '/:id/blocks', { params: { id: '4' } }],
  ['barbers', 'post', '/:id/blocks', { params: { id: '4' }, body: { startsAt: future.toISOString(), endsAt: new Date(future.getTime() + 3_600_000).toISOString() } }],
  ['barbers', 'delete', '/:id/blocks/:blockId', { params: { id: '4', blockId: '3' } }],
  ['settings', 'get', '/'],
  ['settings', 'patch', '/', { body: settingsBody }],
  ['settings', 'post', '/payment-qr', { file: { filename: 'qr-x.png' } }],
  ['settings', 'post', '/brand-image/:kind', { params: { kind: 'logo' }, file: { filename: 'brand-x.png' } }],
  ['admin', 'get', '/dashboard', { query: { dateFrom: '2026-10-01', dateTo: '2026-10-31' } }],
  ['admin', 'get', '/users'],
  ['admin', 'post', '/barber-accounts', { body: { barberId: 4, email: 'nuevo@test.local', password: 'Temporal123' } }],
  ['admin', 'patch', '/users/:id', { params: { id: '55' }, body: { isActive: false } }],
  ['barber', 'patch', '/appointments/:id/complete', { params: { id: '9' } }],
  ['barber', 'patch', '/appointments/:id/status', { params: { id: '9' }, body: { status: 'NO_SHOW' } }],
  ['barber', 'patch', '/appointments/:id/undo', { params: { id: '9' } }],
  ['barber', 'get', '/dashboard'],
  ['appointments', 'get', '/availability', { query: { barberId: '2', serviceIds: '1', date: '2030-03-13' } }],
  ['appointments', 'post', '/multi', { body: { barberId: 2, serviceIds: [1], startsAt: futureStart, paymentProofId: '11111111-1111-4111-8111-111111111111' } }],
  ['appointments', 'get', '/mine'],
  ['appointments', 'get', '/admin', { query: { status: 'PENDING' } }],
  ['appointments', 'patch', '/:id/reschedule', { params: { id: '10' }, body: { startsAt: futureStart } }],
  ['appointments', 'patch', '/:id/cancel', { params: { id: '10' }, body: {} }],
  ['appointments', 'patch', '/:id/status', { params: { id: '10' }, body: { status: 'CONFIRMED' } }],
  ['appointments', 'patch', '/:id/admin-notes', { params: { id: '10' }, body: { adminNotes: 'Nota' } }],
  ['appointments', 'patch', '/:id/correct-status', { params: { id: '10' }, body: { status: 'COMPLETED', reason: 'El barbero se equivocó de botón' } }],
  ['appointments', 'get', '/:id/status-history', { params: { id: '10' } }],
  ['payments', 'post', '/proof', { uploadProof: true }],
  ['payments', 'get', '/proofs/:proofId', { params: { proofId: '11111111-1111-4111-8111-111111111111' } }],
  ['reviews', 'get', '/'],
  ['reviews', 'post', '/', { body: { appointmentId: 10, rating: 5, comment: 'Excelente' } }],
  ['notifications', 'get', '/'],
  ['notifications', 'patch', '/:id/read', { params: { id: '3' } }],
  ['recommendations', 'get', '/', { query: { serviceIds: '1', days: '1' } }]
];

// Respuestas mínimas de una base simulada para que cada ruta llegue a su
// camino de éxito y ejecute todas sus consultas.
function fakeResult(sql, values) {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) return { affectedRows: 1, insertId: 1, rows: [{ id: 1 }] };
  if (/^\s*SET LOCAL/i.test(sql)) return [];
    if (sql.includes('COUNT(*) AS total')) return [{ total: 0 }];
  if (sql.includes('AS "usedElsewhere"')) return [{ isMember: 1, isClient: 0, usedElsewhere: 0 }];
  if (sql.includes('FROM users WHERE email')) return [];
  if (sql.includes('display_name AS "displayName", user_id AS "userId"')) return [{ id: 4, displayName: 'Beto Barbero', userId: null }];
  if (sql.includes('FROM barbers WHERE id = ? AND tenant_id = ? FOR UPDATE')) return [{ userId: 30, isActive: 1 }];
  if (sql.includes('FROM barber_working_hours') && sql.includes('weekday = ?')) return [{ weekday: values[2], start_minutes: 0, end_minutes: 1439 }];
  if (sql.includes('FROM schedule_blocks') && sql.includes('starts_at < ?')) return [];
  if (sql.includes('SELECT id, starts_at, ends_at FROM appointments')) return [];
  if (sql.includes('client_id AS "clientId", barber_id AS "barberId"')) return [{ id: 10, clientId: 5, barberId: 2, serviceId: 1, status: 'CONFIRMED', paymentReference: 'ref-1' }];
  if (sql.includes('client_id AS "clientId", status, payment_reference')) return [{ clientId: 5, status: 'PENDING', paymentReference: 'ref-1' }];
  if (sql.includes('SELECT client_id AS "clientId", payment_reference')) return [{ clientId: 5, paymentReference: 'ref-1' }];
  if (sql.includes('id, barber_id AS "barberId", status')) return [{ id: 10, barberId: 2, status: 'COMPLETED' }];
  if (sql.includes('FROM reviews WHERE appointment_id')) return [];
  if (sql.includes('WHERE service_id = ?')) return [];
  if (sql.includes('b.user_id = ?') && sql.includes('FROM appointments')) return [{ id: 9, clientId: 5, status: 'COMPLETED', hasStarted: true }];
  if (sql.includes('FROM appointment_status_changes') && sql.includes('"withinWindow"')) return [{ id: 1, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', kind: 'CHANGE', changedBy: '10', withinWindow: true }];
  if (sql.includes('client_id AS "clientId", status FROM appointments')) return [{ clientId: 5, status: 'NO_SHOW' }];
  if (sql.includes('FROM appointments a') && sql.includes('COMPLETED') && sql.includes('LIMIT 100')) return [];
  if (sql.includes('duration_minutes AS "durationMinutes"')) return [{ id: 1, serviceId: 1, durationMinutes: 30, price: 50 }];
  return [{ id: 1 }];
}

async function runRoute(router, method, routePath, { params = {}, body, file, query = {}, uploadProof } = {}) {
  const handler = router.stack.find((layer) => layer.route?.path === routePath && layer.route.methods[method]).route.stack.at(-1).handle;
  const calls = [];
  const execute = async (sql, values = []) => { calls.push({ sql, values }); return [fakeResult(sql, values)]; };
  const connection = { execute, query: execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  const original = { execute: pool.execute, query: pool.query, getConnection: pool.getConnection };
  Object.assign(pool, { execute, query: execute, getConnection: async () => connection });
  let uploaded;
  if (uploadProof) {
    mkdirSync(proofsDir, { recursive: true });
    uploaded = { destination: proofsDir, filename: `proof-guardia-${Date.now()}.png` };
    writeFileSync(path.join(proofsDir, uploaded.filename), 'x');
  }
  try {
    const status = await new Promise((resolve, reject) => {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json() { resolve(this.statusCode); return this; },
        send() { resolve(this.statusCode); return this; },
        sendFile() { resolve(this.statusCode); return this; }
      };
      const request = {
        params, file: file ?? uploaded,
        query: { ...query, ...injected }, headers: { 'x-tenant-id': TENANT_B },
        body: body ? { ...body, ...injected } : undefined,
        tenant: { id: TENANT_A, slug: 'barberia-a' }, auth: { sub: '10' }, membership: null,
        protocol: 'http', get: () => 'localhost'
      };
      Promise.resolve(handler(request, response, reject)).catch(reject);
    });
    return { status, calls };
  } finally {
    Object.assign(pool, original);
    if (uploadProof) rmSync(path.join(proofsDir, TENANT_A), { recursive: true, force: true });
  }
}

for (const [moduleName, method, routePath, options] of routes) {
  test(`aislamiento: ${moduleName} ${method.toUpperCase()} ${routePath} filtra por el tenant de la URL`, async () => {
    const { status, calls } = await runRoute(modules[moduleName], method, routePath, options);
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

test('cada ruta de cada módulo de negocio está cubierta por la guardia', () => {
  const declared = Object.entries(modules).flatMap(([name, router]) => router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${name} ${method} ${layer.route.path}`)));
  const covered = routes.map(([name, method, routePath]) => `${name} ${method} ${routePath}`);
  assert.deepEqual([...declared].sort(), [...covered].sort(), 'agrega a esta prueba toda ruta nueva');
});

test('todos los módulos montados por tenant están en la guardia', () => {
  assert.deepEqual([...TENANT_MODULE_PATHS].sort(), Object.keys(modules).map((name) => `/${name}`).sort());
});
