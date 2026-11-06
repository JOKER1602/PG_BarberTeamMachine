import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pool from '../src/config/database.js';
import { createAccessToken, requireAuth, requireRole } from '../src/middleware/auth.js';

function makeResponse() {
  return {
    code: null,
    payload: null,
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
    clearCookie(name) { this.clearedCookie = name; return this; }
  };
}

function makeRequest(cookie) {
  return {
    get(header) {
      return header.toLowerCase() === 'cookie' ? cookie : undefined;
    }
  };
}

function withJwtSecret(callback) {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'phase-8-test-secret';
  try {
    return callback(process.env.JWT_SECRET);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

test('permite a un cliente usar funciones exclusivas de cliente', () => {
  const response = makeResponse();
  let continued = false;
  requireRole('CLIENTE')({ auth: { role: 'CLIENTE' } }, response, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(response.code, null);
});

test('impide que barbero y administrador usen funciones exclusivas de cliente', () => {
  for (const role of ['BARBERO', 'ADMINISTRADOR']) {
    const response = makeResponse();
    let continued = false;
    requireRole('CLIENTE')({ auth: { role } }, response, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(response.code, 403);
    assert.equal(response.payload.message, 'Permisos insuficientes');
  }
});

test('reserva los cambios operativos del barbero para el barbero asignado', () => {
  const response = makeResponse();
  let continued = false;
  requireRole('BARBERO')({ auth: { role: 'CLIENTE' } }, response, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(response.code, 403);
});

async function withUserRow(row, callback) {
  const originalExecute = pool.execute;
  const calls = [];
  pool.execute = async (sql, values) => { calls.push({ sql, values }); return [row ? [row] : []]; };
  try { return await callback(calls); } finally { pool.execute = originalExecute; }
}

function runRequireAuth(request, response) {
  return new Promise((resolve, reject) => {
    const result = requireAuth(request, response, (error) => (error ? reject(error) : resolve(true)));
    Promise.resolve(result).then(() => resolve(false), reject);
  });
}

test('crea un token que solo conserva la identidad; el rol se resuelve en la base', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'phase-8-test-secret';
  try {
    const token = createAccessToken({ id: 42, role: 'CLIENTE' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    assert.equal(payload.sub, '42');
    assert.equal('role' in payload, false);

    await withUserRow({ isActive: 1, role: 'CLIENTE' }, async (calls) => {
      const request = makeRequest(`empyrean_session=${token}`);
      const response = makeResponse();
      const continued = await runRequireAuth(request, response);

      assert.equal(continued, true);
      assert.equal(response.code, null);
      assert.equal(request.auth.sub, '42');
      assert.equal(request.auth.role, 'CLIENTE');
      assert.deepEqual(calls[0].values, ['42']);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('una sesión vigente deja de servir si la cuenta fue desactivada o eliminada', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'phase-8-test-secret';
  try {
    const token = createAccessToken({ id: 7, role: 'BARBERO' });
    for (const row of [{ isActive: 0, role: 'BARBERO' }, null]) {
      await withUserRow(row, async () => {
        const response = makeResponse();
        const continued = await runRequireAuth(makeRequest(`empyrean_session=${token}`), response);
        assert.equal(continued, false);
        assert.equal(response.code, 401);
        assert.equal(response.clearedCookie, 'empyrean_session');
      });
    }
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('el rol se toma de la base, no del token emitido antes del cambio', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'phase-8-test-secret';
  try {
    const token = createAccessToken({ id: 9, role: 'ADMINISTRADOR' });
    await withUserRow({ isActive: 1, role: 'CLIENTE' }, async () => {
      const request = makeRequest(`empyrean_session=${token}`);
      assert.equal(await runRequireAuth(request, makeResponse()), true);
      assert.equal(request.auth.role, 'CLIENTE');
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('rechaza cookies faltantes, tokens inválidos y tokens vencidos', () => {
  withJwtSecret((secret) => {
    const cases = [
      makeRequest(),
      makeRequest('other=value'),
      makeRequest('empyrean_session=token-invalido'),
      makeRequest(`empyrean_session=${jwt.sign({ sub: '7', role: 'CLIENTE' }, secret, { expiresIn: '-1s' })}`)
    ];

    for (const request of cases) {
      const response = makeResponse();
      let continued = false;
      requireAuth(request, response, () => { continued = true; });
      assert.equal(continued, false);
      assert.equal(response.code, 401);
    }
  });
});

test('un rol admite cualquiera de los permisos permitidos y rechaza una identidad ausente', () => {
  const allowedResponse = makeResponse();
  let continued = false;
  requireRole('ADMINISTRADOR', 'BARBERO')({ auth: { role: 'BARBERO' } }, allowedResponse, () => { continued = true; });
  assert.equal(continued, true);

  const deniedResponse = makeResponse();
  requireRole('ADMINISTRADOR')({}, deniedResponse, () => {});
  assert.equal(deniedResponse.code, 403);
  assert.equal(deniedResponse.payload.message, 'Permisos insuficientes');
});
