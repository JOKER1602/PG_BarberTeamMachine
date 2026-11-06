import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import app from '../src/app.js';
import pool from '../src/config/database.js';

let server;
let baseUrl;
const originalExecute = pool.execute;

before(async () => {
  // Las rutas /api/... resuelven la barbería por defecto. Se simula solo esa
  // consulta para que la prueba no necesite una base de datos real.
  pool.execute = async (sql, values) => {
    if (sql.includes('FROM tenants WHERE slug = ?')) return [[{ id: 'tenant-smoke', slug: values[0], displayName: 'Smoke', status: 'ACTIVE' }]];
    throw new Error(`La prueba de humo no debe consultar la base: ${sql}`);
  };
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  pool.execute = originalExecute;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

test('la API expone salud, valida entradas y protege los endpoints privados', async (t) => {
  try {
    const health = await request('/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);

    const invalidAssistant = await request('/assistant/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x' })
    });
    assert.equal(invalidAssistant.response.status, 400);
    assert.match(invalidAssistant.body.message, /al menos tres/i);

    const privateDashboard = await request('/admin/dashboard');
    assert.equal(privateDashboard.response.status, 401);
    assert.equal(privateDashboard.body.message, 'Autenticacion requerida');

    const missingRoute = await request('/ruta-que-no-existe');
    assert.equal(missingRoute.response.status, 404);
    assert.match(missingRoute.body.message, /Ruta no encontrada/);
  } catch (error) {
    // Algunos sandboxes corporativos impiden conexiones loopback aun a un
    // servidor efímero. En un entorno normal esta es una prueba HTTP real.
    if (error?.cause?.code === 'EACCES') t.skip('El sandbox no permite conexiones HTTP loopback.');
    else throw error;
  }
});
