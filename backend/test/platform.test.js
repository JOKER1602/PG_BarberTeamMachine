import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/database.js';
import platformRouter from '../src/routes/platform.js';

// Pruebas de la API de plataforma con una base simulada.
const handler = (path, method) => platformRouter.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;

function fakeDb({ existingSlug = false, existingUser = null } = {}) {
  const calls = [];
  const execute = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes('FROM tenants WHERE slug = ? FOR UPDATE')) return [existingSlug ? [{ id: 't' }] : []];
    if (sql.includes('FROM users WHERE email = ? FOR UPDATE')) return [existingUser ? [existingUser] : []];
    if (/^\s*INSERT/i.test(sql)) return [{ insertId: 77, affectedRows: 1 }];
    if (/^\s*UPDATE/i.test(sql)) return [{ affectedRows: sql.includes('WHERE slug = ?') && values.at(-1) === 'no-existe' ? 0 : 1 }];
    if (sql.includes('SELECT slug, display_name')) return [[{ slug: values[0], displayName: 'X', legalName: 'X', status: 'SUSPENDED' }]];
    return [[]];
  };
  const connection = { execute, beginTransaction: async () => {}, commit: async () => { calls.push({ sql: 'COMMIT' }); }, rollback: async () => { calls.push({ sql: 'ROLLBACK' }); }, release() {} };
  return { calls, execute, connection };
}

async function run(path, method, { body, params = {} } = {}, dbOptions) {
  const db = fakeDb(dbOptions);
  const original = { execute: pool.execute, getConnection: pool.getConnection };
  Object.assign(pool, { execute: db.execute, getConnection: async () => db.connection });
  try {
    const result = await new Promise((resolve, reject) => {
      const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, body: payload }); return this; } };
      Promise.resolve(handler(path, method)({ body, params, auth: { sub: '1' } }, response, reject)).catch(reject);
    });
    return { ...result, calls: db.calls };
  } finally { Object.assign(pool, original); }
}

const validTenant = {
  slug: 'barberia-sur', displayName: 'Barbería Sur', city: 'Sucre', phone: '71234567',
  owner: { email: 'Duena@Sur.test', firstName: 'Ana', lastName: 'Sur', temporaryPassword: 'Temporal123' }
};

test('la API de plataforma exige sesión y operador antes de cualquier ruta', () => {
  const guards = platformRouter.stack.filter((layer) => !layer.route).map((layer) => layer.handle.name);
  assert.deepEqual(guards, ['requireAuth', 'requirePlatformAdmin']);
});

test('crea la barbería con su dueño nuevo, configuración, categorías y membresía', async () => {
  const result = await run('/tenants', 'post', { body: validTenant });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.owner, { email: 'duena@sur.test', accountCreated: true, mustChangePassword: true });
  const userInsert = result.calls.find((call) => call.sql.includes('INSERT INTO users'));
  assert.match(userInsert.sql, /must_change_password/);
  assert.match(userInsert.sql, /'CLIENTE'/, 'la cuenta es de cliente; el panel lo da la membresía');
  assert.ok(!userInsert.values.includes('Temporal123'), 'la contraseña se guarda como hash');
  const tenantInsert = result.calls.find((call) => call.sql.includes('INSERT INTO tenants'));
  const tenantId = tenantInsert.values[0];
  assert.deepEqual(tenantInsert.values.slice(1), ['barberia-sur', 'Barbería Sur', 'Barbería Sur', 'TRIAL']);
  assert.ok(result.calls.some((call) => call.sql.includes('INSERT INTO tenant_settings') && call.values[0] === tenantId));
  assert.equal(result.calls.filter((call) => call.sql.includes('INSERT INTO service_categories') && call.values[0] === tenantId).length, 4);
  const membership = result.calls.find((call) => call.sql.includes('INSERT INTO tenant_memberships'));
  assert.deepEqual(membership.values, [tenantId, 77]);
  assert.match(membership.sql, /'OWNER'/);
  assert.ok(result.calls.some((call) => call.sql === 'COMMIT'));
});

test('reutiliza la cuenta de un dueño existente sin pedir contraseña', async () => {
  const result = await run('/tenants', 'post', { body: { ...validTenant, owner: { email: 'ya@existe.test' } } }, { existingUser: { id: 40, isActive: 1 } });
  assert.equal(result.status, 201);
  assert.equal(result.body.owner.accountCreated, false);
  assert.ok(!result.calls.some((call) => call.sql.includes('INSERT INTO users')));
  assert.equal(result.calls.find((call) => call.sql.includes('INSERT INTO tenant_memberships')).values[1], 40);
});

test('rechaza slug repetido, dueño nuevo incompleto, cuenta desactivada y datos inválidos', async () => {
  assert.equal((await run('/tenants', 'post', { body: validTenant }, { existingSlug: true })).status, 409);
  const incomplete = await run('/tenants', 'post', { body: { ...validTenant, owner: { email: 'nuevo@sur.test' } } });
  assert.equal(incomplete.status, 400);
  assert.ok(incomplete.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal((await run('/tenants', 'post', { body: validTenant }, { existingUser: { id: 40, isActive: 0 } })).status, 409);
  for (const slug of ['Con Espacios', '-inicio', 'acento-é', 'a'.repeat(81)]) {
    assert.equal((await run('/tenants', 'post', { body: { ...validTenant, slug } })).status, 400, slug);
  }
  assert.equal((await run('/tenants', 'post', { body: { ...validTenant, owner: { ...validTenant.owner, temporaryPassword: 'debil' } } })).status, 400);
  assert.equal((await run('/tenants', 'post', { body: { ...validTenant, status: 'SUSPENDED' } })).status, 400, 'no se crea suspendida');
});

test('cambia el estado de una barbería y valida el cambio', async () => {
  const suspended = await run('/tenants/:slug', 'patch', { params: { slug: 'barberia-sur' }, body: { status: 'SUSPENDED' } });
  assert.equal(suspended.status, 200);
  assert.deepEqual(suspended.calls[0].values, ['SUSPENDED', 'barberia-sur']);
  assert.equal((await run('/tenants/:slug', 'patch', { params: { slug: 'no-existe' }, body: { status: 'ACTIVE' } })).status, 404);
  assert.equal((await run('/tenants/:slug', 'patch', { params: { slug: 'barberia-sur' }, body: { status: 'BORRADA' } })).status, 400);
  assert.equal((await run('/tenants/:slug', 'patch', { params: { slug: 'barberia-sur' }, body: {} })).status, 400);
});

test('asigna un dueño a una barbería existente sin duplicar la membresía', async () => {
  const db = fakeDb({ existingUser: { id: 40, isActive: 1 } });
  const execute = db.execute;
  db.execute = async (sql, values) => (sql.includes('FROM tenants WHERE slug = ? FOR UPDATE') ? [[{ id: 'tenant-empyrean' }]] : execute(sql, values));
  db.connection.execute = db.execute;
  const original = { execute: pool.execute, getConnection: pool.getConnection };
  Object.assign(pool, { execute: db.execute, getConnection: async () => db.connection });
  try {
    const result = await new Promise((resolve, reject) => {
      const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, body: payload }); return this; } };
      Promise.resolve(handler('/tenants/:slug/owners', 'post')({ params: { slug: 'empyrean-studio' }, body: { email: 'Dueno@Empyrean.test' }, auth: { sub: '1' } }, response, reject)).catch(reject);
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.owner.accountCreated, false);
    const membership = db.calls.find((call) => call.sql.includes('INSERT INTO tenant_memberships'));
    assert.deepEqual(membership.values, ['tenant-empyrean', 40]);
    assert.match(membership.sql, /ON DUPLICATE KEY UPDATE role = 'OWNER'/);
  } finally { Object.assign(pool, original); }
  assert.equal((await run('/tenants/:slug/owners', 'post', { params: { slug: 'no-existe' }, body: { email: 'a@b.test' } })).status, 404);
  assert.equal((await run('/tenants/:slug/owners', 'post', { params: { slug: 'empyrean-studio' }, body: { email: 'nuevo@b.test' } })).status, 404, 'sin barbería simulada responde 404');
});
