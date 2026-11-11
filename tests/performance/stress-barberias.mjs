// Prueba de estrés de la plataforma: 3 barberías, 26 clientes por día cada una.
//
//   node tests/performance/stress-barberias.mjs
//
// Crea una base TEMPORAL en el MySQL de backend/.env, levanta un servidor propio
// en modo producción (con correo y WhatsApp desactivados) y al terminar elimina
// la base, el usuario y los archivos. No toca la base configurada ni envía mensajes.
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const envFile = dotenv.parse(readFileSync(path.join(backend, '.env')));

const TENANTS = 3;
const CLIENTS_PER_DAY = 26;
const BARBERS = 3;
const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}/api`;
const stamp = Date.now();
const DB = `btm_stress_${stamp}`;
const APP_USER = `stress_${stamp % 100000}`;
const APP_PASSWORD = `Stress${randomBytes(12).toString('hex')}9`;
const PASSWORD = `Clave${randomBytes(6).toString('hex')}A1`;
const uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'btm-stress-'));
const proofImage = Buffer.alloc(300 * 1024, 7); // tamaño típico de una captura de comprobante

const admin = {
  host: envFile.DATABASE_HOST ?? 'localhost', port: Number(envFile.DATABASE_PORT ?? 3306),
  user: envFile.DATABASE_USER ?? 'root', password: envFile.DATABASE_PASSWORD ?? ''
};

// Credenciales reales del .env en blanco: dotenv no pisa variables ya definidas.
const blanked = Object.fromEntries(['EMAIL_HOST', 'RESEND_API_KEY', 'BREVO_API_KEY', 'WHATSAPP_PROVIDER',
  ...Object.keys(envFile).filter((key) => /^(EMAIL_|RESEND|BREVO|META_|TWILIO_|WHATSAPP_)/.test(key))].map((key) => [key, '']));
const serverEnv = {
  ...process.env, ...blanked, NODE_ENV: 'production', PORT: String(PORT), FRONTEND_URL: 'https://estres.test', JWT_SECRET: randomBytes(48).toString('base64url'),
  DATABASE_HOST: admin.host, DATABASE_PORT: String(admin.port), DATABASE_NAME: DB, DATABASE_USER: APP_USER, DATABASE_PASSWORD: APP_PASSWORD, DATABASE_SSL: '',
  TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'x-real-ip', UPLOADS_DIR: uploadsDir, DEFAULT_TENANT_SLUG: 'empyrean-studio'
};

// --- Métricas ---------------------------------------------------------------
const log = (message) => console.log(message);
let bucket = null;
const newBucket = (name) => ({ name, samples: new Map(), unexpected: new Map(), started: Date.now(), ended: 0, cpu: [], rss: [] });
const phases = [];
function startPhase(name) { bucket = newBucket(name); phases.push(bucket); log(`\n▶ ${name}`); }
function endPhase() { bucket.ended = Date.now(); }
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;

let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };

async function call(label, method, url, { cookie, body, form, ip = nextIp(), expect = [200, 201, 204] } = {}) {
  const started = performance.now();
  let status = 0; let data = null; let setCookie;
  try {
    const response = await fetch(BASE + url, {
      method,
      headers: { 'x-real-ip': ip, ...(form ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(60_000)
    });
    status = response.status;
    setCookie = response.headers.getSetCookie?.()[0]?.split(';')[0];
    data = status === 204 ? null : await response.json().catch(() => null);
  } catch (error) { status = error.name === 'TimeoutError' ? 'timeout' : 'red'; data = { message: error.message }; }
  const elapsed = performance.now() - started;
  if (bucket) {
    if (!bucket.samples.has(label)) bucket.samples.set(label, []);
    bucket.samples.get(label).push(elapsed);
    if (!expect.includes(status)) {
      const key = `${label} → ${status}${data?.message ? ` (${String(data.message).slice(0, 70)})` : ''}`;
      bucket.unexpected.set(key, (bucket.unexpected.get(key) ?? 0) + 1);
    }
  }
  return { status, data, cookie: setCookie };
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 0 }, async () => {
    while (index < items.length) { const current = index; index += 1; results[current] = await worker(items[current], current); }
  }));
  return results;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const dateAfter = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
function proofForm() {
  const form = new FormData();
  form.append('proof', new Blob([proofImage], { type: 'image/png' }), 'comprobante.png');
  return form;
}

let serial = 0;
async function registerClient(tenant, ip = nextIp()) {
  serial += 1;
  const email = `cliente${serial}@estres.test`;
  const phone = `7${String(1000000 + serial).slice(-7)}`;
  const result = await call('registro', 'POST', '/auth/register', { ip, body: { firstName: 'Cliente', lastName: 'Prueba', phone, email, password: PASSWORD } });
  return { tenant, email, ip, cookie: result.cookie, status: result.status };
}

async function browse(tenant, client) {
  const t = `/t/${tenant.slug}`;
  await Promise.all([
    call('catálogo', 'GET', t, { ip: client?.ip }), call('catálogo', 'GET', `${t}/settings`, { ip: client?.ip }),
    call('catálogo', 'GET', `${t}/services`, { ip: client?.ip }), call('catálogo', 'GET', `${t}/barbers`, { ip: client?.ip }),
    call('catálogo', 'GET', `${t}/reviews`, { ip: client?.ip })
  ]);
}

// Reserva como un cliente real: mira horarios, sube el comprobante y reserva;
// si otro le ganó el horario (409), elige otro.
async function book(client, date) {
  const { tenant } = client;
  const t = `/t/${tenant.slug}`;
  const proof = await call('subir comprobante', 'POST', `${t}/payments/proof`, { cookie: client.cookie, ip: client.ip, form: proofForm() });
  if (proof.status !== 201) return { ok: false, reason: `comprobante ${proof.status}` };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const barber = pick(tenant.barbers);
    const service = pick(tenant.services);
    const slots = await call('disponibilidad', 'GET', `${t}/appointments/availability?barberId=${barber}&serviceIds=${service}&date=${date}`, { ip: client.ip });
    if (!slots.data?.slots?.length) continue;
    const slot = pick(slots.data.slots);
    const result = await call('reservar', 'POST', `${t}/appointments/multi`, {
      cookie: client.cookie, ip: client.ip, expect: [201, 409],
      body: { barberId: barber, serviceIds: [service], startsAt: slot.startsAt, paymentProofId: proof.data.proofId }
    });
    if (result.status === 201) return { ok: true, id: result.data.ids[0], barber, client, retries: attempt };
    if (result.status !== 409) return { ok: false, reason: `reserva ${result.status}` };
  }
  return { ok: false, reason: 'sin horario tras 12 intentos' };
}

// --- Uso del servidor ---------------------------------------------------------
let server; let serverLog = '';
function sampleServer() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${server.pid} | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress)`], (error, stdout) => {
      try { resolve(error ? null : JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}
let sampling = true;
async function samplingLoop() {
  let last = await sampleServer(); let lastAt = Date.now();
  while (sampling) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await sampleServer();
    const now = Date.now();
    if (current && last && bucket && !bucket.ended) {
      bucket.cpu.push(((current.CPU - last.CPU) / ((now - lastAt) / 1000)) * 100);
      bucket.rss.push(current.WorkingSet64 / 2 ** 20);
    }
    if (current) { last = current; lastAt = now; }
  }
}

function report() {
  log('\n================ RESULTADOS POR FASE ================');
  const out = [];
  for (const phase of phases) {
    const seconds = (phase.ended - phase.started) / 1000;
    const all = [...phase.samples.values()].flat();
    const failures = [...phase.unexpected.values()].reduce((a, b) => a + b, 0);
    const summary = { fase: phase.name, segundos: +seconds.toFixed(1), peticiones: all.length, rps: +(all.length / seconds).toFixed(1), errores: failures,
      cpuPicoPct: Math.round(Math.max(0, ...phase.cpu)), memoriaPicoMB: Math.round(Math.max(0, ...phase.rss)), operaciones: {} };
    log(`\n${phase.name}: ${all.length} peticiones en ${seconds.toFixed(1)} s (${summary.rps} req/s) · errores inesperados: ${failures} · CPU pico ${summary.cpuPicoPct}% de un núcleo · memoria pico ${summary.memoriaPicoMB} MB`);
    for (const [label, values] of phase.samples) {
      const sorted = [...values].sort((a, b) => a - b);
      const stats = { n: sorted.length, p50: Math.round(percentile(sorted, 0.5)), p95: Math.round(percentile(sorted, 0.95)), p99: Math.round(percentile(sorted, 0.99)), max: Math.round(sorted.at(-1)) };
      summary.operaciones[label] = stats;
      log(`   ${label.padEnd(24)} n=${String(stats.n).padEnd(6)} p50=${String(stats.p50).padEnd(6)} p95=${String(stats.p95).padEnd(6)} p99=${String(stats.p99).padEnd(6)} máx=${stats.max} ms`);
    }
    for (const [key, count] of phase.unexpected) log(`   ⚠ ${count}× ${key}`);
    out.push(summary);
  }
  return out;
}

const c = await mysql.createConnection({ ...admin, multipleStatements: true });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
let exitCode = 0;

try {
  // --- Preparación ---------------------------------------------------------
  await c.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const migrated = spawnSync(process.execPath, [path.join(root, 'scripts/migrate.mjs')], {
    env: { ...serverEnv, MIGRATION_DATABASE_URL: `mysql://${encodeURIComponent(admin.user)}:${encodeURIComponent(admin.password)}@${admin.host}:${admin.port}/${DB}` }, encoding: 'utf8'
  });
  if (migrated.status !== 0) throw new Error(`migración: ${migrated.stdout}${migrated.stderr}`);
  server = spawn(process.execPath, ['src/server.js'], { cwd: backend, env: serverEnv });
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  for (let i = 0; i < 40; i += 1) {
    const up = await fetch(`${BASE}/health/ready`).then((r) => r.ok).catch(() => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (i === 39) throw new Error(`el servidor no arrancó:\n${serverLog}`);
  }
  samplingLoop();

  startPhase('Preparación: 3 barberías, 9 barberos, 12 servicios');
  const operator = await call('alta de cuentas', 'POST', '/auth/register', { body: { firstName: 'Olga', lastName: 'Operadora', phone: '70000001', email: 'operadora@estres.test', password: PASSWORD } });
  await c.query(`INSERT INTO ${DB}.platform_administrators (user_id) SELECT id FROM ${DB}.users WHERE email = 'operadora@estres.test'`);
  const tenants = [];
  for (let n = 1; n <= TENANTS; n += 1) {
    const slug = `barberia-estres-${n}`;
    const email = `dueno${n}@estres.test`;
    const created = await call('alta de barbería', 'POST', '/platform/tenants', { cookie: operator.cookie, body: { slug, displayName: `Barbería Estrés ${n}`, city: 'Cochabamba', phone: `7100000${n}`, status: 'ACTIVE', owner: { email, firstName: 'Dueño', lastName: 'Prueba', temporaryPassword: PASSWORD } } });
    if (created.status !== 201) throw new Error(`alta ${slug}: ${JSON.stringify(created.data)}`);
    const owner = (await call('inicio de sesión', 'POST', '/auth/login', { body: { email, password: PASSWORD } })).cookie;
    const t = `/t/${slug}`;
    const categories = (await call('catálogo', 'GET', `${t}/services/categories`)).data.categories;
    const services = [];
    for (const [index, duration] of [30, 30, 45, 45].entries()) {
      services.push((await call('configuración', 'POST', `${t}/services`, { cookie: owner, body: { name: `Servicio ${index + 1}`, price: 40 + index * 10, durationMinutes: duration, categoryId: categories[0].id } })).data.id);
    }
    const barbers = []; const barberCookies = new Map();
    for (const name of ['Uno', 'Dos', 'Tres'].slice(0, BARBERS)) {
      const id = (await call('configuración', 'POST', `${t}/barbers`, { cookie: owner, body: { displayName: `Barbero ${name}` } })).data.id;
      await call('configuración', 'PUT', `${t}/barbers/${id}/services`, { cookie: owner, body: { serviceIds: services } });
      for (let weekday = 1; weekday <= 7; weekday += 1) await call('configuración', 'POST', `${t}/barbers/${id}/working-hours`, { cookie: owner, body: { weekday, startTime: '09:00', endTime: '19:00' } });
      const barberEmail = `barbero${n}${name.toLowerCase()}@estres.test`;
      await call('configuración', 'POST', `${t}/admin/barber-accounts`, { cookie: owner, body: { barberId: id, email: barberEmail, password: PASSWORD } });
      barberCookies.set(id, (await call('inicio de sesión', 'POST', '/auth/login', { body: { email: barberEmail, password: PASSWORD } })).cookie);
      barbers.push(id);
    }
    tenants.push({ slug, owner, services, barbers, barberCookies });
  }
  endPhase();

  // --- 1. Un día real ------------------------------------------------------
  startPhase(`1. Día completo: ${TENANTS * CLIENTS_PER_DAY} clientes, recorrido entero`);
  const dayDate = dateAfter(2);
  const dayClients = tenants.flatMap((tenant) => Array.from({ length: CLIENTS_PER_DAY }, () => tenant));
  const dayBookings = await pool(dayClients, 4, async (tenant) => {
    const client = await registerClient(tenant);
    await browse(tenant, client);
    return book(client, dayDate);
  });
  const dayOk = dayBookings.filter((item) => item.ok);
  await pool(dayOk, 4, async ({ id, client, barber }) => {
    const t = `/t/${client.tenant.slug}`;
    await call('agenda del dueño', 'GET', `${t}/appointments/admin?status=PENDING`, { cookie: client.tenant.owner });
    await call('aprobar pago', 'PATCH', `${t}/appointments/${id}/status`, { cookie: client.tenant.owner, body: { status: 'CONFIRMED' } });
    await call('portal del barbero', 'GET', `${t}/barber/dashboard`, { cookie: client.tenant.barberCookies.get(barber) });
    await call('marcar atendida', 'PATCH', `${t}/barber/appointments/${id}/complete`, { cookie: client.tenant.barberCookies.get(barber) });
    await call('historial cliente', 'GET', `${t}/appointments/mine`, { cookie: client.cookie, ip: client.ip });
    await call('notificaciones', 'GET', `${t}/notifications`, { cookie: client.cookie, ip: client.ip });
    await call('reseña', 'POST', `${t}/reviews`, { cookie: client.cookie, ip: client.ip, body: { appointmentId: id, rating: 5, comment: 'Muy bien' } });
  });
  await pool(tenants, 3, (tenant) => call('panel del dueño', 'GET', `/t/${tenant.slug}/admin/dashboard`, { cookie: tenant.owner }));
  endPhase();
  check(`día completo: ${dayOk.length}/${dayClients.length} reservas creadas`, dayOk.length === dayClients.length, [...new Set(dayBookings.filter((b) => !b.ok).map((b) => b.reason))].join('; '));

  // --- 2. Picos -------------------------------------------------------------
  const burst = async (label, perTenant, days) => {
    startPhase(label);
    const list = tenants.flatMap((tenant) => Array.from({ length: perTenant }, (_, i) => ({ tenant, date: dateAfter(days[i % days.length]) })));
    const started = Date.now();
    const results = await Promise.all(list.map(async ({ tenant, date }) => {
      const client = await registerClient(tenant);
      await browse(tenant, client);
      return book(client, date);
    }));
    endPhase();
    const ok = results.filter((item) => item.ok);
    check(`${label}: ${ok.length}/${list.length} reservas en ${((Date.now() - started) / 1000).toFixed(1)} s`, ok.length === list.length, [...new Set(results.filter((b) => !b.ok).map((b) => b.reason))].join('; '));
    return ok;
  };
  const burst1 = await burst(`2a. Pico: los ${TENANTS * CLIENTS_PER_DAY} clientes del día a la vez`, CLIENTS_PER_DAY, [3]);
  const burst3 = await burst(`2b. Pico x3: ${TENANTS * CLIENTS_PER_DAY * 3} clientes a la vez`, CLIENTS_PER_DAY * 3, [4, 5, 6]);

  // Aprobación masiva concurrente (los dueños validando pagos).
  startPhase(`2c. Aprobación concurrente de ${burst1.length} pagos`);
  await pool(burst1, 15, ({ id, client }) => call('aprobar pago', 'PATCH', `/t/${client.tenant.slug}/appointments/${id}/status`, { cookie: client.tenant.owner, body: { status: 'CONFIRMED' } }));
  endPhase();

  // --- 3. Colisiones ---------------------------------------------------------
  startPhase('3a. Colisión: 20 clientes por barbería, mismo barbero y hora');
  const collisionDate = dateAfter(15);
  const collisionClients = await pool(tenants.flatMap((tenant) => Array.from({ length: 20 }, () => tenant)), 8, (tenant) => registerClient(tenant));
  const prepared = await pool(collisionClients, 8, async (client) => ({ client, proof: (await call('subir comprobante', 'POST', `/t/${client.tenant.slug}/payments/proof`, { cookie: client.cookie, ip: client.ip, form: proofForm() })).data.proofId }));
  const collision = await Promise.all(prepared.map(({ client, proof }) => call('reservar (colisión)', 'POST', `/t/${client.tenant.slug}/appointments/multi`, {
    cookie: client.cookie, ip: client.ip, expect: [201, 409],
    body: { barberId: client.tenant.barbers[0], serviceIds: [client.tenant.services[0]], startsAt: `${collisionDate}T14:00:00.000Z`, paymentProofId: proof }
  }).then((result) => ({ tenant: client.tenant.slug, status: result.status }))));
  endPhase();
  for (const tenant of tenants) {
    const mine = collision.filter((item) => item.tenant === tenant.slug);
    check(`colisión al reservar en ${tenant.slug}: exactamente 1 ganador de 20`, mine.filter((item) => item.status === 201).length === 1, `201: ${mine.filter((i) => i.status === 201).length}, 409: ${mine.filter((i) => i.status === 409).length}`);
  }

  startPhase('3b. Colisión: reprogramar 10 citas a la misma hora, por barbería');
  const rescheduleDate = dateAfter(20);
  const rescheduleResults = await Promise.all(tenants.flatMap((tenant) => {
    const mine = burst1.filter((item) => item.client.tenant === tenant);
    const counts = new Map(); for (const item of mine) counts.set(item.barber, (counts.get(item.barber) ?? 0) + 1);
    const barber = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return mine.filter((item) => item.barber === barber).slice(0, 10).map((item) => call('reprogramar (colisión)', 'PATCH', `/t/${tenant.slug}/appointments/${item.id}/reschedule`, {
      cookie: item.client.cookie, ip: item.client.ip, expect: [200, 409], body: { startsAt: `${rescheduleDate}T15:00:00.000Z` }
    }).then((result) => ({ tenant: tenant.slug, status: result.status })));
  }));
  endPhase();
  for (const tenant of tenants) {
    const mine = rescheduleResults.filter((item) => item.tenant === tenant.slug);
    check(`colisión al reprogramar en ${tenant.slug}: exactamente 1 ganador de ${mine.length}`, mine.filter((item) => item.status === 200).length === 1, `200: ${mine.filter((i) => i.status === 200).length}, 409: ${mine.filter((i) => i.status === 409).length}`);
  }

  // --- 4. Tráfico creciente ---------------------------------------------------
  const availabilityDate = dateAfter(3);
  async function closedLoop(label, users, seconds) {
    startPhase(label);
    const until = Date.now() + seconds * 1000;
    await Promise.all(Array.from({ length: users }, async () => {
      while (Date.now() < until) {
        const tenant = pick(tenants);
        const t = `/t/${tenant.slug}`;
        const roll = Math.random();
        if (roll < 0.45) await call('disponibilidad', 'GET', `${t}/appointments/availability?barberId=${pick(tenant.barbers)}&serviceIds=${pick(tenant.services)}&date=${availabilityDate}`);
        else if (roll < 0.9) await call('catálogo', 'GET', `${t}/${pick(['services', 'barbers', 'settings', 'reviews'])}`);
        else if (roll < 0.95) await call('asistente', 'POST', `${t}/assistant/query`, { body: { query: 'servicio 1 mañana a las 4 pm' } });
        else await call('agenda del dueño', 'GET', `${t}/appointments/admin`, { cookie: tenant.owner });
      }
    }));
    endPhase();
  }
  for (const users of [10, 25, 50, 100, 200]) await closedLoop(`4. Tráfico sostenido: ${users} usuarios sin pausa, 15 s`, users, 15);

  // --- 5. Recordatorios ---------------------------------------------------------
  startPhase('5. Worker de recordatorios');
  const reminderRun = spawnSync(process.execPath, ['--input-type=module', '-e', `const s=performance.now();const {processDueReminders}=await import(${JSON.stringify(new URL('src/services/reminders.js', `file:///${backend.replaceAll('\\', '/')}/`).href)});const {default:p}=await import(${JSON.stringify(new URL('src/config/database.js', `file:///${backend.replaceAll('\\', '/')}/`).href)});await processDueReminders();console.log(Math.round(performance.now()-s));await p.end();`], { cwd: backend, env: serverEnv, encoding: 'utf8' });
  endPhase();
  check('el worker de recordatorios termina sin error', reminderRun.status === 0, `${reminderRun.stdout.trim()} ms ${reminderRun.stderr.slice(0, 200)}`);

  // --- Integridad ----------------------------------------------------------------
  log('\n================ INTEGRIDAD DE DATOS ================');
  const one = async (sql) => (await c.query(sql))[0][0];
  check('sin citas solapadas en ningún barbero', Number((await one(`SELECT COUNT(*) AS n FROM ${DB}.appointments a JOIN ${DB}.appointments b ON a.barber_id = b.barber_id AND a.id < b.id AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at WHERE a.status IN ('PENDING','CONFIRMED','COMPLETED') AND b.status IN ('PENDING','CONFIRMED','COMPLETED')`)).n) === 0,
    `${(await one(`SELECT COUNT(*) AS n FROM ${DB}.appointments a JOIN ${DB}.appointments b ON a.barber_id = b.barber_id AND a.id < b.id AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at WHERE a.status IN ('PENDING','CONFIRMED','COMPLETED') AND b.status IN ('PENDING','CONFIRMED','COMPLETED')`)).n} pares solapados`);
  check('cita, barbero y servicio siempre de la misma barbería', Number((await one(`SELECT COUNT(*) AS n FROM ${DB}.appointments a JOIN ${DB}.barbers b ON b.id = a.barber_id JOIN ${DB}.services s ON s.id = a.service_id WHERE a.tenant_id <> b.tenant_id OR a.tenant_id <> s.tenant_id`)).n) === 0);
  check('reseñas, notificaciones y recordatorios en la barbería de su cita', Number((await one(`SELECT (SELECT COUNT(*) FROM ${DB}.reviews r JOIN ${DB}.appointments a ON a.id = r.appointment_id WHERE r.tenant_id <> a.tenant_id) + (SELECT COUNT(*) FROM ${DB}.notifications n JOIN ${DB}.appointments a ON a.id = n.appointment_id WHERE n.tenant_id <> a.tenant_id) + (SELECT COUNT(*) FROM ${DB}.reminder_jobs r JOIN ${DB}.appointments a ON a.id = r.appointment_id WHERE r.tenant_id <> a.tenant_id) AS n`)).n) === 0);
  check('cada comprobante se usó una sola vez', Number((await one(`SELECT COUNT(*) AS n FROM (SELECT payment_proof_url FROM ${DB}.appointments WHERE payment_proof_url IS NOT NULL GROUP BY payment_proof_url HAVING COUNT(DISTINCT payment_reference) > 1) x`)).n) === 0);
  log(`  Citas por barbería: ${JSON.stringify((await c.query(`SELECT t.slug, COUNT(*) AS citas FROM ${DB}.appointments a JOIN ${DB}.tenants t ON t.id = a.tenant_id GROUP BY t.slug ORDER BY t.slug`))[0])}`);
  const errors = serverLog.split('\n').filter((line) => /error/i.test(line));
  log(`  Líneas de error en el registro del servidor: ${errors.length}${errors.length ? `\n   ${[...new Set(errors)].slice(0, 8).join('\n   ')}` : ''}`);

  const summary = report();
  writeFileSync(process.env.STRESS_OUTPUT || path.join(os.tmpdir(), `estres-${stamp}.json`), JSON.stringify({ phases: summary, checks }, null, 2));
  log(`\n================ RESUMEN ================\nComprobaciones: ${checks.filter((item) => item.ok).length}/${checks.length} correctas`);
  for (const item of checks.filter((entry) => !entry.ok)) log(`  ✖ ${item.name} — ${item.detail}`);
  exitCode = checks.every((item) => item.ok) ? 0 : 1;
} catch (error) {
  console.error('La prueba se interrumpió:', error);
  console.error(serverLog.slice(-2000));
  exitCode = 2;
} finally {
  sampling = false;
  server?.kill();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await c.query(`DROP DATABASE IF EXISTS ${DB}`).catch(() => {});
  await c.query("DROP USER IF EXISTS ?@'%'", [APP_USER]).catch(() => {});
  await c.end();
  rmSync(uploadsDir, { recursive: true, force: true });
  log(`Base temporal ${DB}, usuario y archivos eliminados.`);
  process.exit(exitCode);
}
