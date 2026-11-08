import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimit, loginLimiters } from '../src/middleware/rate-limit.js';

function hit(limiter, request) {
  const response = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let passed = false;
  limiter(request, response, () => { passed = true; });
  return { passed, response };
}

test('permite hasta el máximo y luego responde 429 con Retry-After', () => {
  const limiter = createRateLimit({ windowMs: 60_000, max: 3, key: (request) => request.ip });
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal(hit(limiter, { ip: '1.1.1.1' }).passed, true);
  const blocked = hit(limiter, { ip: '1.1.1.1' });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.response.statusCode, 429);
  assert.ok(Number(blocked.response.headers['Retry-After']) > 0);
  assert.equal(hit(limiter, { ip: '2.2.2.2' }).passed, true, 'otra IP tiene su propio contador');
});

test('la ventana se reinicia al vencer', async () => {
  const limiter = createRateLimit({ windowMs: 30, max: 1, key: () => 'misma' });
  assert.equal(hit(limiter, {}).passed, true);
  assert.equal(hit(limiter, {}).passed, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(hit(limiter, {}).passed, true);
});

test('el límite de inicio de sesión cuenta por IP y correo, sin distinguir mayúsculas', () => {
  const [perAccount] = loginLimiters;
  perAccount.reset();
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal(hit(perAccount, { ip: '9.9.9.9', body: { email: attempt % 2 ? 'Ana@Test.com' : 'ana@test.com' } }).passed, true);
  assert.equal(hit(perAccount, { ip: '9.9.9.9', body: { email: 'ANA@test.com' } }).response.statusCode, 429);
  assert.equal(hit(perAccount, { ip: '9.9.9.9', body: { email: 'otra@test.com' } }).passed, true, 'otra cuenta no queda bloqueada');
  perAccount.reset();
});

test('no se puede desactivar en producción', () => {
  const previous = { env: process.env.NODE_ENV, flag: process.env.RATE_LIMIT_DISABLED };
  process.env.NODE_ENV = 'production';
  process.env.RATE_LIMIT_DISABLED = 'true';
  try {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1, key: () => 'x' });
    hit(limiter, {});
    assert.equal(hit(limiter, {}).response.statusCode, 429);
  } finally {
    process.env.NODE_ENV = previous.env;
    if (previous.flag === undefined) delete process.env.RATE_LIMIT_DISABLED; else process.env.RATE_LIMIT_DISABLED = previous.flag;
  }
});

test('CLIENT_IP_HEADER toma la IP de la cabecera del proxy (p. ej. x-real-ip en Railway)', async () => {
  const { clientIp } = await import('../src/middleware/rate-limit.js');
  const previous = process.env.CLIENT_IP_HEADER;
  const request = { ip: '100.64.0.2', headers: { 'x-real-ip': '181.115.1.20' }, get(name) { return this.headers[name.toLowerCase()]; } };
  try {
    delete process.env.CLIENT_IP_HEADER;
    assert.equal(clientIp(request), '100.64.0.2', 'sin la variable usa request.ip');
    process.env.CLIENT_IP_HEADER = 'X-Real-IP';
    assert.equal(clientIp(request), '181.115.1.20');
    assert.equal(clientIp({ ...request, headers: {} }), '100.64.0.2', 'si falta la cabecera vuelve a request.ip');
  } finally {
    if (previous === undefined) delete process.env.CLIENT_IP_HEADER; else process.env.CLIENT_IP_HEADER = previous;
  }
});
