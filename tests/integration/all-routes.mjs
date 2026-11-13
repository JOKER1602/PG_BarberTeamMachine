// Recorre TODAS las rutas de la API contra un PostgreSQL real.
//
//   TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres node tests/integration/all-routes.mjs
//
// PostgreSQL rechaza algunas consultas solo al ejecutarlas (tipos de parámetros,
// alias, columnas), así que las pruebas con base simulada no bastan. Crea una base
// TEMPORAL (nunca apuntes a Supabase), la elimina al terminar y simula los envíos
// a Resend: no sale ningún correo.
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
const { Client } = require('pg');
if (!process.env.TEST_POSTGRES_URL) { console.error('Define TEST_POSTGRES_URL (un PostgreSQL de pruebas, nunca Supabase).'); process.exit(2); }

const DB = `btm_routes_${Date.now()}`;
const dbUrl = new URL(process.env.TEST_POSTGRES_URL);
dbUrl.pathname = `/${DB}`;
const uploads = mkdtempSync(path.join(os.tmpdir(), 'btm-routes-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: dbUrl.toString(), DATABASE_SSL: '', MIGRATION_DATABASE_URL: '', UPLOADS_DIR: uploads, JWT_SECRET: 'secreto-de-prueba-de-rutas-0123456789',
  CLIENT_IP_HEADER: 'x-real-ip', TRUST_PROXY: 'true', FRONTEND_URL: 'http://localhost:5173', DEFAULT_TENANT_SLUG: 'empyrean-studio',
  RESEND_API_KEY: 're_simulada', BREVO_API_KEY: '', EMAIL_HOST: '', EMAIL_FROM: 'Prueba <hola@prueba.test>'
});

// Solo se simulan los proveedores externos; las llamadas a la API son reales.
const realFetch = globalThis.fetch;
let providerStatus = 200;
const sent = [];
globalThis.fetch = async (url, options) => {
  if (/api\.resend\.com/.test(String(url))) {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'simulado', message: 'simulado' }), { status: providerStatus });
  }
  return realFetch(url, options);
};

const server0 = new Client({ connectionString: process.env.TEST_POSTGRES_URL });
await server0.connect();
await server0.query(`CREATE DATABASE ${DB}`);
const migrated = spawnSync(process.execPath, [path.join(root, 'scripts/migrate.mjs')], { env: process.env, encoding: 'utf8' });
if (migrated.status !== 0) throw new Error(migrated.stdout + migrated.stderr);
const sql = new Client({ connectionString: dbUrl.toString() });
await sql.connect();
await sql.query('SET search_path TO reservas');

const serverErrors = [];
const originalError = console.error;
console.error = (...args) => { serverErrors.push(args.map((arg) => arg?.message ?? String(arg)).join(' ')); };

const { default: app } = await import(pathToFileURL(path.join(backend, 'src/app.js')).href);
const { default: pool } = await import(pathToFileURL(path.join(backend, 'src/config/database.js')).href);
const { processDueReminders } = await import(pathToFileURL(path.join(backend, 'src/services/reminders.js')).href);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

const failures = [];
const covered = new Set();
let total = 0;
let ip = 0;
async function call(method, url, expected, { cookie, body, form } = {}) {
  ip += 1;
  const response = await realFetch(base + url, {
    method,
    headers: { 'x-real-ip': `10.1.${ip >> 8}.${ip & 255}`, ...(form ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined)
  });
  const type = response.headers.get('content-type') ?? '';
  const data = response.status === 204 ? null : type.includes('json') ? await response.json() : await response.arrayBuffer();
  total += 1;
  covered.add(`${method} ${url.replace(/\/t\/[^/?]+/, '').replace(/\/\d+(?=\/|$|\?)/g, '/:id').replace(/\?.*$/, '')}`);
  if (response.status !== expected) failures.push(`${method} ${url}: esperaba ${expected}, recibió ${response.status} ${JSON.stringify(data)?.slice(0, 200)}`);
  return { status: response.status, data, cookie: response.headers.getSetCookie?.()[0]?.split(';')[0] };
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const image = (field, name = 'imagen.png', bytes = PNG) => { const form = new FormData(); form.append(field, new Blob([bytes], { type: 'image/png' }), name); return form; };
const check = (name, ok, detail = '') => { if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`); };
const one = async (text, values) => (await sql.query(text, values)).rows[0];
const PASS = 'ClaveSegura123';
const dateAfter = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

try {
  // --- Cuentas -------------------------------------------------------------------
  const register = async (firstName, email, phone) => (await call('POST', '/auth/register', 201, { body: { firstName, lastName: 'Prueba', phone, email, password: PASS } })).cookie;
  const operator = await register('Olga', 'operadora@rutas.test', '70000001');
  const client = await register('Carla', 'cliente@rutas.test', '70000002');
  await call('POST', '/auth/register', 409, { body: { firstName: 'Carla', lastName: 'Prueba', phone: '70000002', email: 'cliente@rutas.test', password: PASS } });
  await call('POST', '/auth/login', 401, { body: { email: 'cliente@rutas.test', password: 'Incorrecta123' } });
  await sql.query("INSERT INTO platform_administrators (user_id) SELECT id FROM users WHERE email = 'operadora@rutas.test'");

  // --- Plataforma ----------------------------------------------------------------
  const t = '/t/rutas-uno';
  await call('POST', '/platform/tenants', 201, { cookie: operator, body: { slug: 'rutas-uno', displayName: 'Rutas Uno', city: 'Sucre', phone: '71111111', status: 'ACTIVE', owner: { email: 'dueno@rutas.test', firstName: 'Dora', lastName: 'Dueña', temporaryPassword: PASS } } });
  await call('POST', '/platform/tenants', 201, { cookie: operator, body: { slug: 'rutas-dos', displayName: 'Rutas Dos', city: 'Tarija', phone: '72222222', owner: { email: 'cliente@rutas.test' } } });
  await call('POST', '/platform/tenants', 409, { cookie: operator, body: { slug: 'rutas-uno', displayName: 'Otra', city: 'Oruro', phone: '7333333', owner: { email: 'dueno@rutas.test' } } });
  await call('GET', '/platform/tenants', 200, { cookie: operator });
  await call('POST', '/platform/tenants/rutas-dos/owners', 201, { cookie: operator, body: { email: 'dueno@rutas.test' } });
  await call('POST', '/platform/tenants/rutas-dos/owners', 201, { cookie: operator, body: { email: 'dueno@rutas.test' } });
  await call('PATCH', '/platform/tenants/rutas-dos', 200, { cookie: operator, body: { status: 'SUSPENDED', displayName: 'Rutas Dos S' } });
  await call('PATCH', '/platform/tenants/no-existe', 404, { cookie: operator, body: { status: 'ACTIVE' } });
  const owner = (await call('POST', '/auth/login', 200, { body: { email: 'dueno@rutas.test', password: PASS } })).cookie;
  await call('GET', t, 200);

  // --- Catálogo y configuración --------------------------------------------------
  const created = await call('POST', `${t}/services/categories`, 201, { cookie: owner, body: { name: 'Coloración', slug: 'coloracion', description: 'Tintes' } });
  await call('POST', `${t}/services/categories`, 409, { cookie: owner, body: { name: 'coloración', slug: 'otra' } });
  const categories = (await call('GET', `${t}/services/categories`, 200)).data.categories;
  check('el alta devuelve el id de la categoría', Number.isInteger(created.data.id));
  const mkService = async (name, duration = 30) => (await call('POST', `${t}/services`, 201, { cookie: owner, body: { name, price: 50.5, durationMinutes: duration, categoryId: categories[0].id, description: 'x' } })).data.id;
  const service = await mkService('Corte'); const service2 = await mkService('Barba', 20); const disposable = await mkService('Temporal');
  await call('POST', `${t}/services`, 409, { cookie: owner, body: { name: 'CORTE', price: 1, durationMinutes: 10, categoryId: categories[0].id } });
  await call('PATCH', `${t}/services/${service2}`, 200, { cookie: owner, body: { price: 25, isActive: true, description: 'Barba completa' } });
  await call('GET', `${t}/services`, 200); await call('GET', `${t}/services/admin`, 200, { cookie: owner });
  await call('DELETE', `${t}/services/${disposable}`, 200, { cookie: owner });
  await call('DELETE', `${t}/services/999999`, 404, { cookie: owner });

  const settings = await call('GET', `${t}/settings`, 200);
  const saved = await call('PATCH', `${t}/settings`, 200, { cookie: owner, body: { businessName: 'Rutas Uno', address: 'Calle 1', city: 'Sucre', country: 'Bolivia', phone: '7111111', whatsapp: '7111111', hoursText: 'Todo el día', mapsUrl: 'https://maps.test/x', instagramUrl: null, facebookUrl: null, paymentQrUrl: settings.data.settings.paymentQrUrl, description: 'Descripción' } });
  check('guarda la configuración', saved.data?.settings?.address === 'Calle 1');
  await call('POST', `${t}/settings/payment-qr`, 201, { cookie: owner, form: image('qr') });
  await call('POST', `${t}/settings/brand-image/logo`, 400, { cookie: owner, form: image('image', 'falsa.png', Buffer.from('no soy una imagen')) });
  await call('POST', `${t}/settings/brand-image/logo`, 201, { cookie: owner, form: image('image') });
  const cover = await call('POST', `${t}/settings/brand-image/cover`, 201, { cookie: owner, form: image('image') });
  const coverFile = await realFetch(new URL(cover.data.imageUrl, base));
  if (!cover.data.imageUrl.endsWith('.webp') || coverFile.headers.get('content-type') !== 'image/webp') failures.push(`La portada no se sirve como WebP: ${cover.data.imageUrl} (${coverFile.status}, ${coverFile.headers.get('content-type')})`);

  // --- Barberos -------------------------------------------------------------------
  const mkBarber = async (name) => (await call('POST', `${t}/barbers`, 201, { cookie: owner, body: { displayName: name, bio: 'Bio' } })).data.id;
  const barber = await mkBarber('Bruno Barbero'); const barber2 = await mkBarber('Beto Barbero');
  for (const id of [barber, barber2]) {
    await call('PUT', `${t}/barbers/${id}/services`, 200, { cookie: owner, body: { serviceIds: [service, service2] } });
    for (let weekday = 1; weekday <= 7; weekday += 1) await call('POST', `${t}/barbers/${id}/working-hours`, 201, { cookie: owner, body: { weekday, startTime: '08:00', endTime: '20:00' } });
  }
  const hours = await call('GET', `${t}/barbers/${barber2}/working-hours`, 200, { cookie: owner });
  check('horarios como texto HH:MM:SS', /^08:00/.test(hours.data.workingHours[0].startTime), JSON.stringify(hours.data.workingHours[0]));
  const extraHour = await call('POST', `${t}/barbers/${barber2}/working-hours`, 201, { cookie: owner, body: { weekday: 1, startTime: '20:00', endTime: '21:00' } });
  await call('DELETE', `${t}/barbers/${barber2}/working-hours/${extraHour.data.id}`, 204, { cookie: owner });
  await call('DELETE', `${t}/barbers/${barber2}/working-hours/999999`, 404, { cookie: owner });
  const future = new Date(Date.now() + 30 * 86_400_000);
  const block = await call('POST', `${t}/barbers/${barber}/blocks`, 201, { cookie: owner, body: { startsAt: future.toISOString(), endsAt: new Date(future.getTime() + 3_600_000).toISOString(), reason: 'Permiso' } });
  await call('GET', `${t}/barbers/${barber}/blocks`, 200, { cookie: owner });
  await call('DELETE', `${t}/barbers/${barber}/blocks/${block.data.id}`, 204, { cookie: owner });
  await call('POST', `${t}/barbers/${barber}/photo`, 201, { cookie: owner, form: image('photo') });
  await call('PATCH', `${t}/barbers/${barber}`, 200, { cookie: owner, body: { displayName: 'Bruno Barbero', bio: 'Nueva bio' } });
  const barbers = await call('GET', `${t}/barbers`, 200);
  check('el catálogo agrupa los servicios del barbero', barbers.data.barbers.some((item) => item.services?.includes('Barba')), JSON.stringify(barbers.data.barbers[0]));
  const adminBarbers = await call('GET', `${t}/barbers/admin`, 200, { cookie: owner });
  check('serviceIds numéricos en administración', adminBarbers.data.barbers[0].serviceIds.every(Number.isInteger));
  await call('POST', `${t}/admin/barber-accounts`, 201, { cookie: owner, body: { barberId: barber, email: 'bruno@rutas.test', password: PASS } });
  await call('POST', `${t}/admin/barber-accounts`, 409, { cookie: owner, body: { barberId: barber, email: 'otro@rutas.test', password: PASS } });
  const barberCookie = (await call('POST', '/auth/login', 200, { body: { email: 'bruno@rutas.test', password: PASS } })).cookie;

  // --- Reservas --------------------------------------------------------------------
  const book = async (date, index, services = [service]) => {
    const slots = await call('GET', `${t}/appointments/availability?barberId=${barber}&serviceIds=${services.join(',')}&date=${date}`, 200);
    check('hay horarios disponibles', slots.data.slots.length > index, date);
    const proof = await call('POST', `${t}/payments/proof`, 201, { cookie: client, form: image('proof') });
    const result = await call('POST', `${t}/appointments/multi`, 201, { cookie: client, body: { barberId: barber, serviceIds: services, startsAt: slots.data.slots[index].startsAt, paymentProofId: proof.data.proofId } });
    return { ids: result.data.ids, proofId: proof.data.proofId, startsAt: slots.data.slots[index].startsAt };
  };
  await call('GET', `${t}/appointments/availability?barberId=${barber}&serviceId=${service}&date=${dateAfter(1)}`, 200);
  const toConfirm = await book(dateAfter(2), 0, [service, service2]);
  check('una reserva de dos servicios crea dos citas', toConfirm.ids.length === 2);
  const repeated = await call('POST', `${t}/appointments/multi`, 400, { cookie: client, body: { barberId: barber, serviceIds: [service], startsAt: toConfirm.startsAt, paymentProofId: toConfirm.proofId } });
  check('un comprobante no se reutiliza', repeated.status === 400);
  const mine = await call('GET', `${t}/appointments/mine`, 200, { cookie: client });
  check('el total de la reserva suma sus servicios', Number(mine.data.appointments[0].bookingTotal) === 75.5, String(mine.data.appointments[0].bookingTotal));
  check('fechas ISO en UTC', /Z$/.test(new Date(mine.data.appointments[0].startsAt).toISOString()) && mine.data.appointments[0].startsAt === toConfirm.startsAt || new Date(mine.data.appointments.at(-1).startsAt).getTime() === new Date(toConfirm.startsAt).getTime(), JSON.stringify(mine.data.appointments.map((item) => item.startsAt)));
  const agenda = await call('GET', `${t}/appointments/admin?dateFrom=${dateAfter(0)}&dateTo=${dateAfter(40)}&barberId=${barber}&serviceId=${service}&status=PENDING`, 200, { cookie: owner });
  check('la agenda filtra por fecha, barbero, servicio y estado', agenda.data.appointments.length === 1, `${agenda.data.appointments.length}`);
  const proofResponse = await call('GET', `${t}/payments/proofs/${toConfirm.proofId}`, 200, { cookie: owner });
  check('el dueño abre el comprobante', proofResponse.status === 200);
  await call('PATCH', `${t}/appointments/${toConfirm.ids[0]}/admin-notes`, 200, { cookie: owner, body: { adminNotes: 'Nota' } });
  await call('PATCH', `${t}/appointments/${toConfirm.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
  const confirmed = await one("SELECT COUNT(*)::int AS n FROM appointments WHERE payment_reference = (SELECT payment_reference FROM appointments WHERE id = $1) AND status = 'CONFIRMED'", [toConfirm.ids[0]]);
  check('aprobar confirma toda la reserva', confirmed.n === 2);
  const reminders = await one('SELECT COUNT(*)::int AS n FROM reminder_jobs WHERE appointment_id = ANY($1::bigint[])', [toConfirm.ids]);
  check('se programan recordatorios', reminders.n >= 8, `${reminders.n}`);
  await call('PATCH', `${t}/appointments/${toConfirm.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
  const rescheduleSlots = await call('GET', `${t}/appointments/availability?barberId=${barber}&serviceIds=${service},${service2}&date=${dateAfter(3)}`, 200);
  const rescheduled = await call('PATCH', `${t}/appointments/${toConfirm.ids[0]}/reschedule`, 200, { cookie: client, body: { startsAt: rescheduleSlots.data.slots[2].startsAt } });
  check('reprogramar mueve la reserva completa', rescheduled.data.rescheduledIds?.length === 2);
  await call('PATCH', `${t}/appointments/${toConfirm.ids[0]}/cancel`, 200, { cookie: client, body: { reason: 'No puedo' } });
  const cancelled = await one("SELECT COUNT(*)::int AS n FROM appointments WHERE id = ANY($1::bigint[]) AND status = 'CANCELLED'", [toConfirm.ids]);
  check('cancelar anula toda la reserva', cancelled.n === 2);

  // La asistencia solo se marca desde la hora de la cita. Para probarlo sin
  // esperar, «llega la hora» moviendo la cita a hace 5 minutos.
  const arrive = (ids) => sql.query("UPDATE appointments SET ends_at = now() - interval '5 minutes' + (ends_at - starts_at), starts_at = now() - interval '5 minutes' WHERE id = ANY($1::bigint[])", [ids]);
  const statusOf = async (id) => (await one('SELECT status FROM appointments WHERE id = $1', [id])).status;
  const completeByBarber = await book(dateAfter(4), 1);
  await call('PATCH', `${t}/appointments/${completeByBarber.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
  await call('GET', `${t}/barber/dashboard`, 200, { cookie: barberCookie });
  await call('PATCH', `${t}/barber/appointments/${completeByBarber.ids[0]}/complete`, 409, { cookie: barberCookie });
  await arrive(completeByBarber.ids);
  await call('PATCH', `${t}/barber/appointments/${completeByBarber.ids[0]}/complete`, 200, { cookie: barberCookie });
  // Deshacer: el barbero revierte su propio cambio reciente.
  const barberView = await call('GET', `${t}/barber/dashboard`, 200, { cookie: barberCookie });
  const marked = barberView.data.appointments.find((item) => Number(item.id) === Number(completeByBarber.ids[0]));
  check('el panel del barbero ofrece deshacer', marked?.undoUntil && new Date(marked.undoUntil) > new Date(), JSON.stringify(marked));
  await call('PATCH', `${t}/barber/appointments/${completeByBarber.ids[0]}/undo`, 200, { cookie: barberCookie });
  check('deshacer vuelve la cita a confirmada', await statusOf(completeByBarber.ids[0]) === 'CONFIRMED');
  await call('PATCH', `${t}/barber/appointments/${completeByBarber.ids[0]}/undo`, 409, { cookie: barberCookie });
  await call('PATCH', `${t}/barber/appointments/${completeByBarber.ids[0]}/complete`, 200, { cookie: barberCookie });
  await sql.query("UPDATE appointment_status_changes SET created_at = now() - interval '11 minutes' WHERE appointment_id = $1", [completeByBarber.ids[0]]);
  await call('PATCH', `${t}/barber/appointments/${completeByBarber.ids[0]}/undo`, 409, { cookie: barberCookie });
  check('pasada la ventana ya no se puede deshacer', await statusOf(completeByBarber.ids[0]) === 'COMPLETED');
  await call('POST', `${t}/reviews`, 201, { cookie: client, body: { appointmentId: completeByBarber.ids[0], rating: 5, comment: 'Excelente' } });
  await call('POST', `${t}/reviews`, 409, { cookie: client, body: { appointmentId: completeByBarber.ids[0], rating: 4 } });
  const reviews = await call('GET', `${t}/reviews?barberId=${barber}`, 200);
  check('resumen de reseñas', Number(reviews.data.summary.total) === 1 && Number(reviews.data.summary.five) === 1 && Number(reviews.data.summary.average) === 5, JSON.stringify(reviews.data.summary));
  await call('GET', `${t}/reviews`, 200);

  for (const [status, reason] of [['NO_SHOW', undefined], ['CANCELLED', 'Enfermo']]) {
    const appointment = await book(dateAfter(5), status === 'NO_SHOW' ? 1 : 8);
    await call('PATCH', `${t}/appointments/${appointment.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
    // Cancelar se puede antes de la cita; la inasistencia, solo desde su hora.
    if (status === 'NO_SHOW') {
      await call('PATCH', `${t}/barber/appointments/${appointment.ids[0]}/status`, 409, { cookie: barberCookie, body: { status } });
      await arrive(appointment.ids);
    }
    await call('PATCH', `${t}/barber/appointments/${appointment.ids[0]}/status`, 200, { cookie: barberCookie, body: { status, ...(reason ? { reason } : {}) } });
  }
  const adminMarked = {};
  for (const [days, status] of [[6, 'COMPLETED'], [7, 'NO_SHOW']]) {
    const appointment = await book(dateAfter(days), 1);
    await call('PATCH', `${t}/appointments/${appointment.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
    await call('PATCH', `${t}/appointments/${appointment.ids[0]}/status`, 409, { cookie: owner, body: { status } });
    await arrive(appointment.ids);
    await call('PATCH', `${t}/appointments/${appointment.ids[0]}/status`, 200, { cookie: owner, body: { status } });
    adminMarked[status] = appointment.ids[0];
  }
  // Corrección del dueño: motivo obligatorio, historial y aviso al cliente.
  const wrongNoShow = adminMarked.NO_SHOW;
  await call('PATCH', `${t}/appointments/${wrongNoShow}/correct-status`, 400, { cookie: owner, body: { status: 'COMPLETED', reason: 'no' } });
  await call('PATCH', `${t}/appointments/${wrongNoShow}/correct-status`, 409, { cookie: owner, body: { status: 'NO_SHOW', reason: 'Ya estaba así' } });
  await call('PATCH', `${t}/appointments/${wrongNoShow}/correct-status`, 403, { cookie: barberCookie, body: { status: 'COMPLETED', reason: 'El barbero intenta corregir' } });
  await call('PATCH', `${t}/appointments/${wrongNoShow}/correct-status`, 200, { cookie: owner, body: { status: 'COMPLETED', reason: 'El barbero se equivocó de botón' } });
  check('la corrección cambia el estado', await statusOf(wrongNoShow) === 'COMPLETED');
  const history = await call('GET', `${t}/appointments/${wrongNoShow}/status-history`, 200, { cookie: owner });
  check('el historial registra la corrección con su motivo', history.data.history[0]?.kind === 'CORRECTION' && history.data.history[0]?.reason === 'El barbero se equivocó de botón' && history.data.history.some((entry) => entry.toStatus === 'NO_SHOW'), JSON.stringify(history.data.history));
  const correctionNotice = await one("SELECT COUNT(*)::int AS n FROM notifications WHERE appointment_id = $1 AND type = 'APPOINTMENT_STATUS_CORRECTED'", [wrongNoShow]);
  check('se avisa al cliente de la corrección', correctionNotice.n === 1);
  const agendaRow = (await call('GET', `${t}/appointments/admin`, 200, { cookie: owner })).data.appointments.find((item) => Number(item.id) === Number(wrongNoShow));
  check('la agenda muestra el motivo de la corrección', agendaRow?.correctionReason === 'El barbero se equivocó de botón', JSON.stringify(agendaRow));
  await call('PATCH', `${t}/appointments/${wrongNoShow}/correct-status`, 200, { cookie: owner, body: { status: 'NO_SHOW', reason: 'Volvemos al estado original' } });
  const rejected = await book(dateAfter(8), 1);
  await call('PATCH', `${t}/appointments/${rejected.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CANCELLED', reason: 'Pago inválido' } });
  await call('PATCH', `${t}/barbers/${barber2}`, 200, { cookie: owner, body: { isActive: false } });
  await call('PATCH', `${t}/barbers/${barber2}`, 200, { cookie: owner, body: { isActive: true } });
  await call('PATCH', `${t}/barbers/${barber}`, 200, { cookie: owner, body: { isActive: false } });
  await call('PATCH', `${t}/barbers/${barber}`, 200, { cookie: owner, body: { isActive: true } });
  const pendingBooking = await book(dateAfter(9), 1);
  const blocked = await call('PATCH', `${t}/barbers/${barber}`, 409, { cookie: owner, body: { isActive: false } });
  check('no desactiva con citas por atender', blocked.data?.upcomingAppointments === 1, JSON.stringify(blocked.data));
  await call('PATCH', `${t}/appointments/${pendingBooking.ids[0]}/cancel`, 200, { cookie: owner, body: {} });

  // --- Panel, usuarios y recomendaciones --------------------------------------------
  const dashboard = await call('GET', `${t}/admin/dashboard?dateFrom=${dateAfter(0)}&dateTo=${dateAfter(40)}&barberId=${barber}&serviceId=${service}`, 200, { cookie: owner });
  check('el panel cuenta citas y atendidas', Number(dashboard.data.metrics.appointments) > 0 && Number(dashboard.data.metrics.completed) >= 2 && Number(dashboard.data.metrics.occupiedMinutes) > 0, JSON.stringify(dashboard.data.metrics));
  check('horas locales en el panel', dashboard.data.busyHours.every((item) => /^\d{2}:00$/.test(item.label)) && dashboard.data.dailyAppointments.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date)), JSON.stringify(dashboard.data.busyHours));
  await call('GET', `${t}/admin/dashboard`, 200, { cookie: owner });
  const users = await call('GET', `${t}/admin/users`, 200, { cookie: owner });
  const clientRow = users.data.users.find((item) => item.email === 'cliente@rutas.test');
  check('usuarios de la barbería', clientRow && Number(clientRow.appointmentCount) > 0, JSON.stringify(clientRow));
  // Un cliente aparece en el panel desde que se registra o entra por la página
  // de la barbería, aunque aún no haya reservado; uno ajeno, no.
  await call('POST', '/auth/register', 201, { body: { firstName: 'Nina', lastName: 'Prueba', phone: '70000011', email: 'nina@rutas.test', password: PASS, tenantSlug: 'rutas-uno' } });
  await call('POST', '/auth/register', 201, { body: { firstName: 'Omar', lastName: 'Prueba', phone: '70000012', email: 'omar@rutas.test', password: PASS } });
  const listedEmails = async () => (await call('GET', `${t}/admin/users`, 200, { cookie: owner })).data.users.map((item) => item.email);
  let listed = await listedEmails();
  check('cliente registrado en la barbería aparece sin reservas', listed.includes('nina@rutas.test'), listed.join(','));
  check('cliente de ninguna barbería no aparece', !listed.includes('omar@rutas.test'), listed.join(','));
  await call('POST', '/auth/login', 200, { body: { email: 'omar@rutas.test', password: PASS, tenantSlug: 'rutas-uno' } });
  await call('POST', '/auth/login', 200, { body: { email: 'dueno@rutas.test', password: PASS, tenantSlug: 'rutas-uno' } });
  listed = await listedEmails();
  check('cliente que inicia sesión en la barbería aparece', listed.includes('omar@rutas.test'), listed.join(','));
  check('el personal no se duplica como cliente', listed.filter((email) => email === 'dueno@rutas.test').length === 1, listed.join(','));
  const linkedStaff = await one("SELECT count(*)::int AS n FROM tenant_clients tc JOIN users u ON u.id = tc.user_id WHERE u.email = 'dueno@rutas.test'");
  check('solo las cuentas CLIENTE se vinculan como clientes', linkedStaff.n === 0, JSON.stringify(linkedStaff));
  const barberRow = users.data.users.find((item) => item.email === 'bruno@rutas.test');
  await call('PATCH', `${t}/admin/users/${barberRow.id}`, 200, { cookie: owner, body: { isActive: false } });
  await call('PATCH', `${t}/admin/users/${barberRow.id}`, 200, { cookie: owner, body: { isActive: true } });
  await call('PATCH', `${t}/admin/users/${clientRow.id}`, 409, { cookie: owner, body: { isActive: false } }).catch(() => {});
  await call('PATCH', `${t}/admin/users/999999`, 404, { cookie: owner, body: { isActive: false } });
  const noServices = await call('GET', `${t}/recommendations`, 200, { cookie: client });
  check('recomienda desde el historial', noServices.data.basedOnHistory === true && noServices.data.serviceSuggestions.length > 0);
  const withServices = await call('GET', `${t}/recommendations?serviceIds=${service}&days=3`, 200, { cookie: client });
  check('sugiere horarios', withServices.data.timeSuggestions.length > 0);
  const fresh = await register('Nueva', 'nueva@rutas.test', '70000005');
  await call('GET', `${t}/recommendations`, 200, { cookie: fresh });

  // --- Notificaciones y cuenta ---------------------------------------------------------
  const notifications = await call('GET', `${t}/notifications`, 200, { cookie: client });
  check('hay notificaciones', notifications.data.notifications.length > 0);
  await call('PATCH', `${t}/notifications/${notifications.data.notifications[0].id}/read`, 204, { cookie: client });
  await call('GET', '/auth/me', 200, { cookie: client });
  const profile = await call('PATCH', '/auth/me', 200, { cookie: client, body: { firstName: 'Carla', lastName: 'Prueba', phone: '71234567' } });
  check('guarda el teléfono del perfil', profile.data?.user?.phone === '71234567' && !('whatsappConsent' in (profile.data?.user ?? {})), JSON.stringify(profile.data?.user));
  await call('PATCH', '/auth/me/password', 400, { cookie: client, body: { currentPassword: 'Incorrecta123', password: 'OtraClave123' } });
  await call('PATCH', '/auth/me/password', 200, { cookie: client, body: { currentPassword: PASS, password: 'OtraClave123' } });

  await call('POST', '/auth/forgot-password', 200, { body: { email: 'cliente@rutas.test', tenantSlug: 'rutas-uno' } });
  const mail = sent.find((item) => /Restablece/.test(item.body.subject ?? ''));
  check('el correo de recuperación lleva la marca', mail?.body.subject.includes('Rutas Uno'), JSON.stringify(mail?.body?.subject));
  const token = mail?.body.text.match(/token=([0-9a-f]{64})/)?.[1];
  await call('POST', '/auth/reset-password', 200, { body: { token, password: 'ClaveNueva123' } });
  await call('POST', '/auth/reset-password', 400, { body: { token, password: 'ClaveNueva123' } });
  check('el token se guarda como hash', Boolean(await one('SELECT 1 AS ok FROM password_reset_tokens WHERE token_hash = $1', [createHash('sha256').update(token ?? '').digest('hex')])));
  await call('POST', '/auth/login', 200, { body: { email: 'cliente@rutas.test', password: 'ClaveNueva123' } });

  // --- Worker de recordatorios: correo, aviso interno y reintento ----------------------
  const due = await book(dateAfter(1), 12, [service, service2]);
  await call('PATCH', `${t}/appointments/${due.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
  await sql.query("UPDATE reminder_jobs SET scheduled_at = now() - interval '1 minute' WHERE appointment_id = ANY($1::bigint[])", [due.ids]);
  sent.length = 0;
  await processDueReminders();
  const after = (await sql.query('SELECT channel, status, COUNT(*)::int AS n FROM reminder_jobs WHERE appointment_id = ANY($1::bigint[]) GROUP BY channel, status', [due.ids])).rows;
  const count = (channel, status) => after.find((row) => row.channel === channel && row.status === status)?.n ?? 0;
  check('envía correo y aviso interno', count('EMAIL', 'SENT') === 4 && count('IN_APP', 'SENT') === 4, JSON.stringify(after));
  check('solo correo y aviso interno, sin WhatsApp', after.every((row) => ['EMAIL', 'IN_APP'].includes(row.channel)), JSON.stringify(after));
  check('Resend recibe los envíos', sent.some((item) => item.url.includes('resend')));

  const failing = await book(dateAfter(1), 20);
  await call('PATCH', `${t}/appointments/${failing.ids[0]}/status`, 200, { cookie: owner, body: { status: 'CONFIRMED' } });
  await sql.query("UPDATE reminder_jobs SET scheduled_at = now() - interval '1 minute' WHERE appointment_id = $1 AND channel = 'EMAIL'", [failing.ids[0]]);
  providerStatus = 500;
  await processDueReminders();
  providerStatus = 200;
  const retry = await one("SELECT status, attempts, last_error FROM reminder_jobs WHERE appointment_id = $1 AND channel = 'EMAIL' LIMIT 1", [failing.ids[0]]);
  check('un fallo del proveedor se reintenta', retry.status === 'PENDING' && retry.attempts === 1 && retry.last_error?.includes('Resend'), JSON.stringify(retry));

  // --- Borrado de comprobantes vencidos -----------------------------------------------
  const { deleteExpiredPaymentProofs } = await import(pathToFileURL(path.join(backend, 'src/services/payment-proof-retention.js')).href);
  const stillPending = await book(dateAfter(9), 1);
  const unusedProof = (await call('POST', `${t}/payments/proof`, 201, { cookie: client, form: image('proof') })).data.proofId;
  const recentProof = (await call('POST', `${t}/payments/proof`, 201, { cookie: client, form: image('proof') })).data.proofId;
  const fileOf = async (id) => { const row = await one('SELECT storage_key AS key FROM payment_proofs WHERE id = $1', [id]); return row && path.join(uploads, 'payments', row.key); };
  const proofFiles = { approved: await fileOf(toConfirm.proofId), pending: await fileOf(stillPending.proofId), unused: await fileOf(unusedProof) };
  check('los comprobantes existen antes de la limpieza', Object.values(proofFiles).every((file) => file && existsSync(file)), JSON.stringify(proofFiles));
  await sql.query("UPDATE payment_proofs SET created_at = now() - interval '21 days' WHERE id <> $1", [recentProof]);
  const deletedProofs = await deleteExpiredPaymentProofs();
  const remainingProofs = (await sql.query('SELECT id FROM payment_proofs')).rows.map((row) => row.id);
  check('borra los comprobantes de pagos revisados y los no usados', deletedProofs > 0 && !remainingProofs.includes(toConfirm.proofId) && !remainingProofs.includes(unusedProof), `borrados ${deletedProofs}`);
  check('borra también la imagen del disco', !existsSync(proofFiles.approved) && !existsSync(proofFiles.unused));
  check('conserva el comprobante de un pago pendiente de revisión', remainingProofs.includes(stillPending.proofId) && existsSync(proofFiles.pending));
  check('conserva los comprobantes recientes', remainingProofs.includes(recentProof));
  const paidAppointment = await one('SELECT payment_proof_url, payment_amount, payment_reference FROM appointments WHERE id = $1', [toConfirm.ids[0]]);
  check('la cita conserva monto y referencia sin el enlace', paidAppointment.payment_proof_url === null && paidAppointment.payment_amount !== null && paidAppointment.payment_reference !== null, JSON.stringify(paidAppointment));
  await call('GET', `${t}/payments/proofs/${toConfirm.proofId}`, 404, { cookie: owner });
  const agendaAfterCleanup = await call('GET', `${t}/appointments/admin`, 200, { cookie: owner });
  check('el panel sigue listando el pago', agendaAfterCleanup.data.appointments.some((item) => item.id === toConfirm.ids[0] && item.paymentProofUrl === null && item.paymentAmount != null));
  check('una segunda pasada no borra nada más', (await deleteExpiredPaymentProofs()) === 0);

  await call('GET', '/health', 200);
  await call('GET', '/health/ready', 200);
  await call('POST', '/auth/logout', 204, { cookie: client });

  // --- Validación de sesión del aislamiento ------------------------------------------
  const tenantOf = await one("SELECT (SELECT COUNT(*)::int FROM appointments a JOIN barbers b ON b.id = a.barber_id WHERE a.tenant_id <> b.tenant_id) AS n");
  check('sin citas cruzadas entre barberías', tenantOf.n === 0);
} catch (error) {
  failures.push(`La prueba se interrumpió: ${error.stack}`);
} finally {
  console.error = originalError;
  server.close();
  await pool.end().catch(() => {});
  await sql.end().catch(() => {});
  await server0.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => {});
  await server0.end();
  rmSync(uploads, { recursive: true, force: true });
  const unexpected = serverErrors.filter((line) => !/simulado/.test(line));
  console.log(`Peticiones: ${total} · rutas distintas: ${covered.size}`);
  console.log([...covered].sort().join('\n'));
  if (unexpected.length) console.log(`\nErrores registrados por el servidor (${unexpected.length}):\n${[...new Set(unexpected)].slice(0, 25).join('\n')}`);
  if (failures.length) console.log(`\nFALLOS (${failures.length}):\n${failures.join('\n')}`);
  else console.log('\nTodas las comprobaciones correctas.');
  process.exit(failures.length || unexpected.length ? 1 : 0);
}
