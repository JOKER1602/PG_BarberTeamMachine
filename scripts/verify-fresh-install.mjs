// Verificación de instalación desde cero (SOLO desarrollo / ensayo previo al despliegue).
//
//
//   TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres node scripts/verify-fresh-install.mjs
//
// Crea una base TEMPORAL en ese PostgreSQL (nunca apuntes a Supabase: requiere
// permiso CREATE DATABASE), aplica las migraciones, arranca la API contra ella
// con una carpeta de subidas temporal y recorre la puesta en marcha real: primer
// registro, operador, dueños, configuración, QR, servicio, reserva con
// comprobante y aprobación. Elimina la base y los archivos al terminar.
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
process.chdir(backend);
const require = createRequire(path.join(backend, 'package.json'));
require('dotenv').config({ path: path.join(backend, '.env') });
const { Client } = require('pg');
const scratch = `btm_fresh_${Date.now()}`;
const uploadsDir = mkdtempSync(path.join(tmpdir(), 'btm-fresh-uploads-'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

if (!process.env.TEST_POSTGRES_URL) { console.error('Define TEST_POSTGRES_URL (un PostgreSQL de pruebas, nunca Supabase).'); process.exit(2); }
const admin = new Client({ connectionString: process.env.TEST_POSTGRES_URL });
await admin.connect();
const scratchUrl = new URL(process.env.TEST_POSTGRES_URL);
scratchUrl.pathname = `/${scratch}`;
let server; let pool;
try {
  await admin.query(`CREATE DATABASE ${scratch}`);
  const migrated = spawnSync(process.execPath, [path.join(root, 'scripts/migrate.mjs')], { env: { ...process.env, DATABASE_URL: scratchUrl.toString(), MIGRATION_DATABASE_URL: '', DATABASE_SSL: '' }, encoding: 'utf8' });
  check('migraciones de instalación nueva aplicadas', migrated.status === 0, migrated.stdout + migrated.stderr);

  process.env.DATABASE_URL = scratchUrl.toString();
  process.env.DATABASE_SSL = '';
  process.env.UPLOADS_DIR = uploadsDir;
  const { default: app } = await import(pathToFileURL(path.join(backend, 'src/app.js')));
  ({ default: pool } = await import(pathToFileURL(path.join(backend, 'src/config/database.js'))));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, { cookie, body, form } = {}) => {
    const response = await fetch(base + url, { method, headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const password = `Fresh${randomBytes(6).toString('hex')}9`;

  check('la API declara la base lista', (await call('GET', '/health/ready')).data?.ok === true);
  check('Empyrean existe como barbería inicial', (await call('GET', '/t/empyrean-studio')).status === 200);

  // 1. Primera persona: se registra y se designa operadora con el script.
  const registered = await call('POST', '/auth/register', { body: { firstName: 'Olga', lastName: 'Operadora', phone: '71111111', email: 'operadora@fresh.test', password } });
  check('registro público de la primera cuenta', registered.status === 201, JSON.stringify(registered.data));
  execFileSync(process.execPath, [path.join(root, 'scripts/platform-admin.mjs'), 'agregar', 'operadora@fresh.test'], { env: process.env });
  const operator = (await call('POST', '/auth/login', { body: { email: 'operadora@fresh.test', password } })).cookie;
  check('el script la convierte en operadora', (await call('GET', '/platform/tenants', { cookie: operator })).status === 200);

  // 2. Dueño de Empyrean (barbería inicial) y una segunda barbería.
  const empyreanOwner = await call('POST', '/platform/tenants/empyrean-studio/owners', { cookie: operator, body: { email: 'dueno@fresh.test', firstName: 'Ernesto', lastName: 'Empyrean', temporaryPassword: password } });
  check('el operador asigna el dueño de Empyrean', empyreanOwner.status === 201 && empyreanOwner.data.owner.accountCreated);
  const second = await call('POST', '/platform/tenants', { cookie: operator, body: { slug: 'barberia-dos', displayName: 'Barbería Dos', city: 'Sucre', phone: '72222222', status: 'ACTIVE', owner: { email: 'dueno2@fresh.test', firstName: 'Diana', lastName: 'Dos', temporaryPassword: password } } });
  check('el operador crea una segunda barbería', second.status === 201);

  // 3. El dueño configura su barbería.
  const owner = (await call('POST', '/auth/login', { body: { email: 'dueno@fresh.test', password } })).cookie;
  check('el dueño cambia su contraseña temporal', (await call('PATCH', '/auth/me/password', { cookie: owner, body: { currentPassword: password, password: `${password}X` } })).status === 200);
  const settings = await call('PATCH', '/t/empyrean-studio/settings', { cookie: owner, body: { businessName: 'Empyrean Studio', address: 'Buenos Aires 135', city: 'Cochabamba', country: 'Bolivia', phone: '77469963', whatsapp: '77469963', hoursText: 'Lunes a sábado' } });
  check('guarda la configuración del negocio', settings.status === 200);
  const qrForm = new FormData();
  qrForm.append('qr', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'qr.png');
  const qr = await call('POST', '/t/empyrean-studio/settings/payment-qr', { cookie: owner, form: qrForm });
  check('sube el QR de pagos (ruta relativa)', qr.status === 201 && qr.data.paymentQrUrl.startsWith('/uploads/qr/'));
  const resaved = await call('PATCH', '/t/empyrean-studio/settings', { cookie: owner, body: { ...qr.data.settings } });
  check('vuelve a guardar la configuración con el QR relativo', resaved.status === 200, JSON.stringify(resaved.data));
  const categories = (await call('GET', '/t/empyrean-studio/services/categories')).data.categories;
  const service = await call('POST', '/t/empyrean-studio/services', { cookie: owner, body: { name: 'Corte clásico', price: 60, durationMinutes: 30, categoryId: categories[0].id } });
  const barber = await call('POST', '/t/empyrean-studio/barbers', { cookie: owner, body: { displayName: 'Bruno Barbero' } });
  await call('PUT', `/t/empyrean-studio/barbers/${barber.data.id}/services`, { cookie: owner, body: { serviceIds: [service.data.id] } });
  for (let weekday = 1; weekday <= 7; weekday += 1) await call('POST', `/t/empyrean-studio/barbers/${barber.data.id}/working-hours`, { cookie: owner, body: { weekday, startTime: '08:00', endTime: '20:00' } });
  check('crea servicio, barbero y horarios', service.status === 201 && barber.status === 201);

  // 4. Un cliente reserva y paga el anticipo.
  await call('POST', '/auth/register', { body: { firstName: 'Carla', lastName: 'Cliente', phone: '73333333', email: 'cliente@fresh.test', password } });
  const client = (await call('POST', '/auth/login', { body: { email: 'cliente@fresh.test', password } })).cookie;
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const slots = await call('GET', `/t/empyrean-studio/appointments/availability?barberId=${barber.data.id}&serviceIds=${service.data.id}&date=${tomorrow}`);
  const proofForm = new FormData();
  proofForm.append('proof', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'comprobante.png');
  const proof = await call('POST', '/t/empyrean-studio/payments/proof', { cookie: client, form: proofForm });
  const booking = await call('POST', '/t/empyrean-studio/appointments/multi', { cookie: client, body: { barberId: barber.data.id, serviceIds: [service.data.id], startsAt: slots.data.slots[4].startsAt, paymentProofId: proof.data.proofId } });
  check('el cliente reserva con su comprobante', booking.status === 201, JSON.stringify(booking.data));

  // 5. El dueño revisa el comprobante y confirma.
  const agenda = await call('GET', '/t/empyrean-studio/appointments/admin', { cookie: owner });
  const proofUrl = agenda.data.appointments[0]?.paymentProofUrl;
  check('el enlace al comprobante es relativo y lo abre el dueño', proofUrl?.startsWith('/api/t/empyrean-studio/payments/proofs/') && (await fetch(`http://127.0.0.1:${server.address().port}${proofUrl}`, { headers: { Cookie: owner } })).status === 200);
  check('el dueño aprueba el pago', (await call('PATCH', `/t/empyrean-studio/appointments/${booking.data.ids[0]}/status`, { cookie: owner, body: { status: 'CONFIRMED' } })).status === 200);
  check('el dueño de la otra barbería no ve esta cita', (await call('GET', '/t/barberia-dos/appointments/admin', { cookie: (await call('POST', '/auth/login', { body: { email: 'dueno2@fresh.test', password } })).cookie })).data.appointments.length === 0);
  check('el límite de intentos protege el inicio de sesión', await (async () => {
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) last = await call('POST', '/auth/login', { body: { email: 'cliente@fresh.test', password: 'Incorrecta123' } });
    return last.status === 429;
  })());
} catch (error) {
  check('la prueba terminó sin errores', false, error.stack);
} finally {
  server?.close();
  await pool?.end().catch(() => {});
  rmSync(uploadsDir, { recursive: true, force: true });
  await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await admin.end();
  check(`base temporal ${scratch} eliminada`, true);
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ''}`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} comprobaciones correctas`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
