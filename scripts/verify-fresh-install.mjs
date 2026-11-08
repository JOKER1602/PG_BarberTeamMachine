// Verificación de instalación desde cero (SOLO desarrollo / ensayo previo al despliegue).
//
//   node scripts/verify-fresh-install.mjs
//
// Crea una base TEMPORAL en el MySQL de backend/.env (requiere permiso CREATE
// DATABASE), aplica las migraciones de una instalación nueva (001, 002, 007,
// 013, 014, 015, 016), arranca la API contra ella con una carpeta de subidas
// temporal y recorre la puesta en marcha real: primer registro, operador,
// dueños, configuración, QR, servicio, reserva con comprobante y aprobación.
// Elimina la base y los archivos al terminar. No toca la base configurada.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const mysql = require('mysql2/promise');
const scratch = `btm_fresh_${Date.now()}`;
const uploadsDir = mkdtempSync(path.join(tmpdir(), 'btm-fresh-uploads-'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

const admin = await mysql.createConnection({ host: process.env.DATABASE_HOST ?? 'localhost', port: Number(process.env.DATABASE_PORT ?? 3306), user: process.env.DATABASE_USER ?? 'root', password: process.env.DATABASE_PASSWORD ?? '', multipleStatements: true });
const migrations = ['001_initial_schema.sql', '002_barber_role.sql', '007_service_categories.sql', '013_saas_foundation.sql', '014_tenant_isolation.sql', '015_tenant_branding.sql', '016_relative_upload_urls.sql'];
let server; let pool;
try {
  await admin.query(`CREATE DATABASE ${scratch} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const file of migrations) {
    const sql = readFileSync(path.join(root, 'database', file), 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS barber_team_machine[\s\S]*?;/, '')
      .replaceAll('USE barber_team_machine;', `USE ${scratch};`);
    await admin.query(`USE ${scratch}; ${sql}`);
  }
  check(`migraciones de instalación nueva aplicadas: ${migrations.map((m) => m.slice(0, 3)).join(', ')}`, true);

  process.env.DATABASE_NAME = scratch;
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

  check('la API declara la base lista (013-015 presentes)', (await call('GET', '/health/ready')).data?.ok === true);
  check('Empyrean existe como barbería inicial', (await call('GET', '/t/empyrean-studio')).status === 200);

  // 1. Primera persona: se registra y se designa operadora con el script.
  const registered = await call('POST', '/auth/register', { body: { firstName: 'Olga', lastName: 'Operadora', phone: '71111111', email: 'operadora@fresh.test', password } });
  check('registro público de la primera cuenta', registered.status === 201, JSON.stringify(registered.data));
  execFileSync(process.execPath, [path.join(root, 'scripts/platform-admin.mjs'), 'agregar', 'operadora@fresh.test'], { env: { ...process.env, DATABASE_NAME: scratch } });
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
  qrForm.append('qr', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'qr.png');
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
  proofForm.append('proof', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'comprobante.png');
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
  await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
  await admin.end();
  check(`base temporal ${scratch} eliminada`, true);
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.detail && !r.ok ? ` — ${r.detail}` : ''}`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} comprobaciones correctas`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
