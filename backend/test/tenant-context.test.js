import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/database.js';
import {
  TENANT_ADMIN_ROLES,
  isValidTenantSlug,
  requirePlatformAdmin,
  requireTenantMembership,
  resolveTenant,
  tenantIdOf
} from '../src/middleware/tenant.js';

const TENANT_A = { id: 'aaaaaaaa-0000-0000-0000-000000000001', slug: 'empyrean-studio', displayName: 'Empyrean Studio', status: 'ACTIVE' };
const TENANT_B = { id: 'bbbbbbbb-0000-0000-0000-000000000002', slug: 'barberia-norte', displayName: 'Barbería Norte', status: 'ACTIVE' };

// Base simulada con dos barberías. Usuario 10: OWNER de A. Usuario 20: BARBER
// de B. Usuario 30: ADMIN inactivo de A. Usuario 99: operador de plataforma.
const db = {
  tenants: [TENANT_A, TENANT_B, { id: 'c', slug: 'suspendida', displayName: 'S', status: 'SUSPENDED' }, { id: 'd', slug: 'cerrada', displayName: 'C', status: 'CANCELLED' }],
  memberships: [
    { tenantId: TENANT_A.id, userId: '10', role: 'OWNER', isActive: true },
    { tenantId: TENANT_B.id, userId: '20', role: 'BARBER', isActive: true },
    { tenantId: TENANT_A.id, userId: '30', role: 'ADMIN', isActive: false }
  ],
  platformAdmins: ['99']
};

async function withFakeDatabase(callback) {
  const originalExecute = pool.execute;
  const calls = [];
  pool.execute = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('FROM tenants WHERE slug = ?')) return [db.tenants.filter((tenant) => tenant.slug === values[0])];
    if (sql.includes('FROM tenant_memberships')) {
      return [db.memberships
        .filter((item) => item.tenantId === values[0] && item.userId === String(values[1]) && item.isActive)
        .map(({ role }) => ({ role }))];
    }
    if (sql.includes('FROM platform_administrators')) return [db.platformAdmins.filter((id) => id === String(values[0])).map((id) => ({ user_id: id }))];
    throw new Error(`Consulta no contemplada: ${sql}`);
  };
  try { return await callback(calls); } finally { pool.execute = originalExecute; }
}

function run(middleware, request) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ continued: false, status: this.statusCode, body, request }); return this; }
    };
    Promise.resolve(middleware(request, response, (error) => (error ? reject(error) : resolve({ continued: true, request })))).catch(reject);
  });
}

// resolveTenant + requireTenantMembership, como se montarán en las rutas.
async function accessAs(userId, slug, roles = []) {
  const request = { params: { tenantSlug: slug }, auth: { sub: userId } };
  const resolved = await run(resolveTenant, request);
  if (!resolved.continued) return resolved;
  return run(requireTenantMembership(...roles), request);
}

test('valida el formato del slug igual que la base', () => {
  for (const slug of ['empyrean-studio', 'a', 'barberia-2']) assert.equal(isValidTenantSlug(slug), true, slug);
  for (const slug of ['', '-inicio', 'fin-', 'Mayusculas', 'con espacio', 'acento-é', 'a'.repeat(81), undefined, 42]) {
    assert.equal(isValidTenantSlug(slug), false, String(slug));
  }
});

test('resuelve el tenant desde el slug de la URL', async () => {
  await withFakeDatabase(async () => {
    const result = await run(resolveTenant, { params: { tenantSlug: 'empyrean-studio' } });
    assert.equal(result.continued, true);
    assert.deepEqual({ ...result.request.tenant }, TENANT_A);
    assert.equal(tenantIdOf(result.request), TENANT_A.id);
  });
});

test('ignora un tenant_id enviado por el navegador', async () => {
  await withFakeDatabase(async () => {
    const request = {
      params: { tenantSlug: 'empyrean-studio' },
      body: { tenantId: TENANT_B.id, tenant_id: TENANT_B.id },
      query: { tenantId: TENANT_B.id },
      headers: { 'x-tenant-id': TENANT_B.id }
    };
    const result = await run(resolveTenant, request);
    assert.equal(result.continued, true);
    assert.equal(tenantIdOf(result.request), TENANT_A.id);
  });
});

test('rechaza barberías inexistentes, dadas de baja, suspendidas o con slug inválido', async () => {
  await withFakeDatabase(async (calls) => {
    for (const slug of ['no-existe', 'cerrada']) {
      const result = await run(resolveTenant, { params: { tenantSlug: slug } });
      assert.equal(result.status, 404, slug);
    }
    const suspended = await run(resolveTenant, { params: { tenantSlug: 'suspendida' } });
    assert.equal(suspended.status, 403);
    assert.equal(suspended.body.code, 'TENANT_SUSPENDED');

    const before = calls.length;
    const invalid = await run(resolveTenant, { params: { tenantSlug: "x' OR '1'='1" } });
    assert.equal(invalid.status, 404);
    assert.equal(calls.length, before, 'un slug inválido no llega a la base');
  });
});

test('permite al personal con membresía activa y rol permitido', async () => {
  await withFakeDatabase(async () => {
    const result = await accessAs('10', 'empyrean-studio', TENANT_ADMIN_ROLES);
    assert.equal(result.continued, true);
    assert.deepEqual({ ...result.request.membership }, { tenantId: TENANT_A.id, role: 'OWNER' });
  });
});

test('aislamiento: la membresía en una barbería no da acceso a otra', async () => {
  await withFakeDatabase(async () => {
    // OWNER de A intentando entrar a B.
    const ownerOfA = await accessAs('10', 'barberia-norte', TENANT_ADMIN_ROLES);
    assert.equal(ownerOfA.status, 403);
    assert.equal(ownerOfA.request.membership, undefined);
    // Barbero de B intentando entrar a A, incluso sin exigir rol concreto.
    const barberOfB = await accessAs('20', 'empyrean-studio');
    assert.equal(barberOfB.status, 403);
  });
});

test('rechaza membresías inactivas, roles no permitidos y clientes sin membresía', async () => {
  await withFakeDatabase(async () => {
    assert.equal((await accessAs('30', 'empyrean-studio', TENANT_ADMIN_ROLES)).status, 403, 'membresía inactiva');
    assert.equal((await accessAs('20', 'barberia-norte', TENANT_ADMIN_ROLES)).status, 403, 'barbero en ruta de administración');
    assert.equal((await accessAs('20', 'barberia-norte', ['BARBER'])).continued, true, 'barbero en su ruta');
    assert.equal((await accessAs('55', 'empyrean-studio')).status, 403, 'cliente sin membresía');
  });
});

test('un operador de plataforma no administra barberías por defecto', async () => {
  await withFakeDatabase(async () => {
    const tenantAccess = await accessAs('99', 'empyrean-studio', TENANT_ADMIN_ROLES);
    assert.equal(tenantAccess.status, 403);

    const platform = await run(requirePlatformAdmin, { auth: { sub: '99' } });
    assert.equal(platform.continued, true);
    const notPlatform = await run(requirePlatformAdmin, { auth: { sub: '10' } });
    assert.equal(notPlatform.status, 403);
    const anonymous = await run(requirePlatformAdmin, {});
    assert.equal(anonymous.status, 401);
  });
});

test('falla de forma segura si una ruta olvida resolver el tenant o la sesión', async () => {
  await withFakeDatabase(async (calls) => {
    await assert.rejects(run(requireTenantMembership(), { auth: { sub: '10' } }), /requiere resolveTenant/);
    assert.throws(() => tenantIdOf({}), /no resolvió el tenant/);
    const noSession = await run(requireTenantMembership(), { tenant: { id: TENANT_A.id } });
    assert.equal(noSession.status, 401);
    assert.equal(calls.length, 0);
  });
  assert.throws(() => requireTenantMembership('ADMINISTRADOR'), /Roles de tenant desconocidos/);
});
