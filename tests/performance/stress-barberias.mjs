// Prueba de estrés y capacidad de la plataforma.
//
//   TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres node tests/performance/stress-barberias.mjs
//
// Escenario (variables opcionales):
//   STRESS_TENANTS=4               barberías
//   STRESS_BARBERS=3,4             barberos por barbería (se repite el patrón: 3, 4, 3, 4)
//   STRESS_SERVICES_PER_BARBER=9   servicios por barbero al día (clientes del día = barberos × servicios)
// Entorno de producción simulado (opcional):
//   STRESS_DOCKER_IMAGE=reservas-prueba  corre la API en esa imagen Docker en vez de un proceso local
//   STRESS_CPUS=0.5 STRESS_MEMORY=512m   límites del contenedor (tamaño de la instancia)
//   STRESS_DB_LATENCY_MS=20              ida y vuelta añadida a cada intercambio con la base
//
// Con TEST_POSTGRES_URL (un PostgreSQL de pruebas, nunca Supabase) crea una base TEMPORAL, levanta un servidor propio
// en modo producción (con el correo desactivado) y al terminar elimina
// la base, el usuario y los archivos. No toca la base configurada ni envía mensajes.
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
const dotenv = require('dotenv');
const { Client } = require('pg');
const envFile = dotenv.parse(readFileSync(path.join(backend, '.env')));

const TENANTS = Number(process.env.STRESS_TENANTS ?? 4);
const BARBER_PATTERN = (process.env.STRESS_BARBERS ?? '3,4').split(',').map(Number);
const SERVICES_PER_BARBER = Number(process.env.STRESS_SERVICES_PER_BARBER ?? 9);
const barbersOf = (n) => BARBER_PATTERN[(n - 1) % BARBER_PATTERN.length];
const TOTAL_BARBERS = Array.from({ length: TENANTS }, (_, i) => barbersOf(i + 1)).reduce((a, b) => a + b, 0);
const DAY_CLIENTS = TOTAL_BARBERS * SERVICES_PER_BARBER;
const DOCKER_IMAGE = process.env.STRESS_DOCKER_IMAGE;
const CPUS = process.env.STRESS_CPUS ?? '0.5';
const MEMORY = process.env.STRESS_MEMORY ?? '512m';
const DB_LATENCY_MS = Number(process.env.STRESS_DB_LATENCY_MS ?? 0);
const CONTAINER = `btm-estres-${Date.now()}`;
const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}/api`;
const stamp = Date.now();
const DB = `btm_stress_${stamp}`;
const APP_USER = `stress_${stamp % 100000}`;
const APP_PASSWORD = `Stress${randomBytes(12).toString('hex')}9`;
const PASSWORD = `Clave${randomBytes(6).toString('hex')}A1`;
const uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'btm-stress-'));
const proofImage = await sharp(randomBytes(400 * 250 * 3), { raw: { width: 400, height: 250, channels: 3 } }).png().toBuffer(); // tamaño típico de una captura de comprobante

if (!process.env.TEST_POSTGRES_URL) { console.error('Define TEST_POSTGRES_URL (un PostgreSQL de pruebas, nunca Supabase).'); process.exit(2); }
const databaseUrl = (database, user, password) => {
  const url = new URL(process.env.TEST_POSTGRES_URL);
  url.pathname = `/${database}`;
  if (user) { url.username = user; url.password = password; }
  return url.toString();
};

// Credenciales reales del .env en blanco: dotenv no pisa variables ya definidas.
const blanked = Object.fromEntries(['EMAIL_HOST', 'RESEND_API_KEY', 'BREVO_API_KEY',
  ...Object.keys(envFile).filter((key) => /^(EMAIL_|RESEND|BREVO)/.test(key))].map((key) => [key, '']));
const serverEnv = {
  ...process.env, ...blanked, NODE_ENV: 'production', PORT: String(PORT), FRONTEND_URL: 'https://estres.test', JWT_SECRET: randomBytes(48).toString('base64url'),
  DATABASE_URL: databaseUrl(DB, APP_USER, APP_PASSWORD), DATABASE_SSL: '',
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

// --- Latencia simulada hacia la base ------------------------------------------
// Proxy TCP que retrasa cada intercambio la mitad del ida y vuelta en cada sentido.
let latencyProxy;
function startLatencyProxy(targetPort) {
  const delay = DB_LATENCY_MS / 2;
  latencyProxy = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    const relay = (from, to) => from.on('data', (chunk) => setTimeout(() => { if (!to.destroyed) to.write(chunk); }, delay));
    relay(client, upstream); relay(upstream, client);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close);
  });
  return new Promise((resolve) => latencyProxy.listen(0, '127.0.0.1', () => resolve(latencyProxy.address().port)));
}

// --- Uso del servidor ---------------------------------------------------------
let server; let serverLog = '';
const parseSize = (text) => { const [, value, unit] = text.trim().match(/([\d.]+)\s*([KMG]?i?B)/) ?? []; return Number(value) * ({ B: 1 / 2 ** 20, KiB: 1 / 1024, MiB: 1, GiB: 1024, kB: 1 / 1024, MB: 1, GB: 1024 }[unit] ?? 0); };
function sampleContainer() {
  return new Promise((resolve) => {
    execFile('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}};{{.MemUsage}}', CONTAINER], (error, stdout) => {
      if (error) return resolve(null);
      const [cpu, mem] = stdout.trim().split(';');
      resolve({ cpu: parseFloat(cpu), rss: parseSize(mem.split('/')[0]) });
    });
  });
}
function sampleServer() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${server.pid} | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress)`], (error, stdout) => {
      try { resolve(error ? null : JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}
let sampling = true;
async function samplingLoop() {
  if (DOCKER_IMAGE) {
    while (sampling) {
      const current = await sampleContainer();
      if (current && bucket && !bucket.ended) { bucket.cpu.push(current.cpu); bucket.rss.push(current.rss); }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return;
  }
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

const server0 = new Client({ connectionString: process.env.TEST_POSTGRES_URL });
await server0.connect();
let c;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`); };
let exitCode = 0;

try {
  // --- Preparación ---------------------------------------------------------
  await server0.query(`CREATE DATABASE ${DB}`);
  c = new Client({ connectionString: databaseUrl(DB) });
  await c.connect();
  const migrated = spawnSync(process.execPath, [path.join(root, 'scripts/migrate.mjs')], {
    env: { ...serverEnv, MIGRATION_DATABASE_URL: databaseUrl(DB) }, encoding: 'utf8'
  });
  if (migrated.status !== 0) throw new Error(`migración: ${migrated.stdout}${migrated.stderr}`);
  const appUrlVia = (host, port) => { const url = new URL(databaseUrl(DB, APP_USER, APP_PASSWORD)); url.hostname = host; url.port = String(port); return url.toString(); };
  const proxyPort = (DOCKER_IMAGE || DB_LATENCY_MS) ? await startLatencyProxy(Number(new URL(process.env.TEST_POSTGRES_URL).port || 5432)) : null;
  if (DOCKER_IMAGE) {
    // Mismas variables que en producción, sin claves de correo.
    const containerEnv = { NODE_ENV: 'production', PORT: '3000', FRONTEND_URL: serverEnv.FRONTEND_URL, JWT_SECRET: serverEnv.JWT_SECRET,
      DATABASE_URL: appUrlVia('host.docker.internal', proxyPort), DATABASE_SSL: '', TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'x-real-ip',
      DEFAULT_TENANT_SLUG: 'empyrean-studio' };
    const args = ['run', '-d', '--name', CONTAINER, `--cpus=${CPUS}`, `--memory=${MEMORY}`, '-p', `${PORT}:3000`, ...Object.entries(containerEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]), DOCKER_IMAGE];
    const started = spawnSync('docker', args, { encoding: 'utf8' });
    if (started.status !== 0) throw new Error(`docker run: ${started.stderr}`);
    server = { kill: () => spawnSync('docker', ['rm', '-f', CONTAINER]) };
  } else {
    const env = proxyPort ? { ...serverEnv, DATABASE_URL: appUrlVia('127.0.0.1', proxyPort) } : serverEnv;
    server = spawn(process.execPath, ['src/server.js'], { cwd: backend, env });
    server.stdout.on('data', (chunk) => { serverLog += chunk; });
    server.stderr.on('data', (chunk) => { serverLog += chunk; });
  }
  log(`Entorno: ${DOCKER_IMAGE ? `Docker ${DOCKER_IMAGE}, ${CPUS} vCPU, ${MEMORY} de RAM` : 'proceso local sin límites'} · latencia simulada a la base: ${DB_LATENCY_MS} ms ida y vuelta`);
  log(`Escenario: ${TENANTS} barberías, ${TOTAL_BARBERS} barberos, ${SERVICES_PER_BARBER} servicios por barbero → ${DAY_CLIENTS} reservas al día`);
  for (let i = 0; i < 40; i += 1) {
    const up = await fetch(`${BASE}/health/ready`).then((r) => r.ok).catch(() => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (i === 39) throw new Error(`el servidor no arrancó:\n${DOCKER_IMAGE ? spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' }).stderr : serverLog}`);
  }
  samplingLoop();

  startPhase(`Preparación: ${TENANTS} barberías, ${TOTAL_BARBERS} barberos, ${TENANTS * 4} servicios`);
  const operator = await call('alta de cuentas', 'POST', '/auth/register', { body: { firstName: 'Olga', lastName: 'Operadora', phone: '70000001', email: 'operadora@estres.test', password: PASSWORD } });
  await c.query(`INSERT INTO reservas.platform_administrators (user_id) SELECT id FROM reservas.users WHERE email = 'operadora@estres.test'`);
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
    for (const name of ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'].slice(0, barbersOf(n))) {
      const id = (await call('configuración', 'POST', `${t}/barbers`, { cookie: owner, body: { displayName: `Barbero ${name}` } })).data.id;
      await call('configuración', 'PUT', `${t}/barbers/${id}/services`, { cookie: owner, body: { serviceIds: services } });
      for (let weekday = 1; weekday <= 7; weekday += 1) await call('configuración', 'POST', `${t}/barbers/${id}/working-hours`, { cookie: owner, body: { weekday, startTime: '09:00', endTime: '19:00' } });
      const barberEmail = `barbero${n}${name.toLowerCase()}@estres.test`;
      await call('configuración', 'POST', `${t}/admin/barber-accounts`, { cookie: owner, body: { barberId: id, email: barberEmail, password: PASSWORD } });
      barberCookies.set(id, (await call('inicio de sesión', 'POST', '/auth/login', { body: { email: barberEmail, password: PASSWORD } })).cookie);
      barbers.push(id);
    }
    tenants.push({ slug, owner, services, barbers, barberCookies, clientsPerDay: barbers.length * SERVICES_PER_BARBER });
  }
  endPhase();

  // --- 1. Un día real ------------------------------------------------------
  startPhase(`1. Día completo: ${DAY_CLIENTS} clientes, recorrido entero`);
  const dayDate = dateAfter(2);
  const dayClients = tenants.flatMap((tenant) => Array.from({ length: tenant.clientsPerDay }, () => tenant));
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
  // Los clientes del pico ya tienen cuenta (se registran antes, fuera de la medición):
  // el pico mide reservas simultáneas. El registro masivo se mide aparte (fase 2d).
  const burst = async (label, multiplier, days) => {
    const list = tenants.flatMap((tenant) => Array.from({ length: tenant.clientsPerDay * multiplier }, (_, i) => ({ tenant, date: dateAfter(days[i % days.length]) })));
    bucket = null;
    const ready = await pool(list, 4, async ({ tenant, date }) => ({ client: await registerClient(tenant), date }));
    startPhase(label);
    const started = Date.now();
    const results = await Promise.all(ready.map(async ({ client, date }) => {
      await browse(client.tenant, client);
      return book(client, date);
    }));
    endPhase();
    const ok = results.filter((item) => item.ok);
    check(`${label}: ${ok.length}/${list.length} reservas en ${((Date.now() - started) / 1000).toFixed(1)} s`, ok.length === list.length, [...new Set(results.filter((b) => !b.ok).map((b) => b.reason))].join('; '));
    return ok;
  };
  const burst1 = await burst(`2a. Pico: los ${DAY_CLIENTS} clientes del día a la vez`, 1, [3]);
  await burst(`2b. Pico x3: ${DAY_CLIENTS * 3} clientes a la vez`, 3, [4, 5, 6]);

  // Aprobación masiva concurrente (los dueños validando pagos).
  startPhase(`2c. Aprobación concurrente de ${burst1.length} pagos`);
  await pool(burst1, 15, ({ id, client }) => call('aprobar pago', 'PATCH', `/t/${client.tenant.slug}/appointments/${id}/status`, { cookie: client.tenant.owner, body: { status: 'CONFIRMED' } }));
  endPhase();

  // Registro de clientes nuevos a la vez: cada contraseña se cifra con bcrypt
  // (costo 12), lo más pesado en CPU de toda la API.
  for (const signups of [10, 30]) {
    startPhase(`2d. Registro simultáneo de ${signups} clientes nuevos`);
    const started = Date.now();
    const created = await Promise.all(Array.from({ length: signups }, (_, i) => registerClient(tenants[i % tenants.length])));
    endPhase();
    const ok = created.filter((item) => item.status === 201).length;
    log(`  ${ok}/${signups} registros en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

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
    if (!mine.length) return [];
    const counts = new Map(); for (const item of mine) counts.set(item.barber, (counts.get(item.barber) ?? 0) + 1);
    const barber = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return mine.filter((item) => item.barber === barber).slice(0, 10).map((item) => call('reprogramar (colisión)', 'PATCH', `/t/${tenant.slug}/appointments/${item.id}/reschedule`, {
      cookie: item.client.cookie, ip: item.client.ip, expect: [200, 409], body: { startsAt: `${rescheduleDate}T15:00:00.000Z` }
    }).then((result) => ({ tenant: tenant.slug, status: result.status })));
  }));
  endPhase();
  for (const tenant of tenants) {
    const mine = rescheduleResults.filter((item) => item.tenant === tenant.slug);
    check(`colisión al reprogramar en ${tenant.slug}: exactamente 1 ganador de ${mine.length}`, mine.length > 0 && mine.filter((item) => item.status === 200).length === 1, `200: ${mine.filter((i) => i.status === 200).length}, 409: ${mine.filter((i) => i.status === 409).length}`);
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
        else if (roll < 0.95) await call('catálogo', 'GET', `${t}/${pick(['services', 'barbers', 'settings', 'reviews'])}`);
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
  const one = async (sql) => (await c.query(sql)).rows[0];
  check('sin citas solapadas en ningún barbero', Number((await one(`SELECT COUNT(*) AS n FROM reservas.appointments a JOIN reservas.appointments b ON a.barber_id = b.barber_id AND a.id < b.id AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at WHERE a.status IN ('PENDING','CONFIRMED','COMPLETED') AND b.status IN ('PENDING','CONFIRMED','COMPLETED')`)).n) === 0,
    `${(await one(`SELECT COUNT(*) AS n FROM reservas.appointments a JOIN reservas.appointments b ON a.barber_id = b.barber_id AND a.id < b.id AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at WHERE a.status IN ('PENDING','CONFIRMED','COMPLETED') AND b.status IN ('PENDING','CONFIRMED','COMPLETED')`)).n} pares solapados`);
  check('cita, barbero y servicio siempre de la misma barbería', Number((await one(`SELECT COUNT(*) AS n FROM reservas.appointments a JOIN reservas.barbers b ON b.id = a.barber_id JOIN reservas.services s ON s.id = a.service_id WHERE a.tenant_id <> b.tenant_id OR a.tenant_id <> s.tenant_id`)).n) === 0);
  check('reseñas, notificaciones y recordatorios en la barbería de su cita', Number((await one(`SELECT (SELECT COUNT(*) FROM reservas.reviews r JOIN reservas.appointments a ON a.id = r.appointment_id WHERE r.tenant_id <> a.tenant_id) + (SELECT COUNT(*) FROM reservas.notifications n JOIN reservas.appointments a ON a.id = n.appointment_id WHERE n.tenant_id <> a.tenant_id) + (SELECT COUNT(*) FROM reservas.reminder_jobs r JOIN reservas.appointments a ON a.id = r.appointment_id WHERE r.tenant_id <> a.tenant_id) AS n`)).n) === 0);
  check('cada comprobante se usó una sola vez', Number((await one(`SELECT COUNT(*) AS n FROM (SELECT payment_proof_url FROM reservas.appointments WHERE payment_proof_url IS NOT NULL GROUP BY payment_proof_url HAVING COUNT(DISTINCT payment_reference) > 1) x`)).n) === 0);
  if (DOCKER_IMAGE) { const logs = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' }); serverLog = logs.stdout + logs.stderr; }
  log(`  Citas por barbería: ${JSON.stringify((await c.query(`SELECT t.slug, COUNT(*)::int AS citas FROM reservas.appointments a JOIN reservas.tenants t ON t.id = a.tenant_id GROUP BY t.slug ORDER BY t.slug`)).rows)}`);
  const errors = serverLog.split('\n').filter((line) => /error/i.test(line));
  log(`  Líneas de error en el registro del servidor: ${errors.length}${errors.length ? `\n   ${[...new Set(errors)].slice(0, 8).join('\n   ')}` : ''}`);

  const summary = report();
  writeFileSync(process.env.STRESS_OUTPUT || path.join(os.tmpdir(), `estres-${stamp}.json`), JSON.stringify({ config: { tenants: TENANTS, barbers: TOTAL_BARBERS, servicesPerBarber: SERVICES_PER_BARBER, dayClients: DAY_CLIENTS, docker: DOCKER_IMAGE ?? null, cpus: DOCKER_IMAGE ? CPUS : null, memory: DOCKER_IMAGE ? MEMORY : null, dbLatencyMs: DB_LATENCY_MS }, phases: summary, checks }, null, 2));
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
  latencyProxy?.close();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await c?.end().catch(() => {});
  await server0.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => {});
  await server0.query(`DROP ROLE IF EXISTS ${APP_USER}`).catch(() => {});
  await server0.end();
  rmSync(uploadsDir, { recursive: true, force: true });
  log(`Base temporal ${DB}, usuario y archivos eliminados.`);
  process.exit(exitCode);
}
