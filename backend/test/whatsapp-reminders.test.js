import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBolivianPhone, sendWhatsAppReminder } from '../src/services/whatsapp.js';
import { scheduleAppointmentReminders, cancelAppointmentReminders, processDueReminders } from '../src/services/reminders.js';
import pool from '../src/config/database.js';

test('normaliza números móviles bolivianos y rechaza números inválidos', () => {
  assert.equal(normalizeBolivianPhone('+591 71234567'), '+59171234567');
  assert.equal(normalizeBolivianPhone('61234567'), '+59161234567');
  assert.throws(() => normalizeBolivianPhone('1234'), /número móvil boliviano válido/);
  assert.throws(() => normalizeBolivianPhone('+591 41234567'), /número móvil boliviano válido/);
});

test('programa WhatsApp solo dos horas antes y para citas confirmadas', async () => {
  const calls = [];
  const connection = { execute: async (sql, values) => { calls.push({ sql, values }); return [{}]; } };
  await scheduleAppointmentReminders(connection, 17);
  const whatsapp = calls.filter(({ sql }) => sql.includes("'WHATSAPP'"));
  assert.equal(whatsapp.length, 1);
  assert.match(whatsapp[0].sql, /'2H'/);
  assert.match(whatsapp[0].sql, /status = 'CONFIRMED'/);
  assert.match(whatsapp[0].sql, /INTERVAL 2 HOUR/);
  assert.deepEqual(whatsapp[0].values, [17]);
  await cancelAppointmentReminders(connection, 17);
  assert.match(calls.at(-1).sql, /status = 'CANCELLED'/);
});

test('envía a Twilio la plantilla aprobada sin exponer el token', async () => {
  const keys = ['WHATSAPP_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WHATSAPP_CONTENT_SID'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { WHATSAPP_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'secret', TWILIO_WHATSAPP_FROM: '+14155238886', TWILIO_WHATSAPP_CONTENT_SID: 'HXtest' });
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url, options }; return { ok: true }; };
  try {
    await sendWhatsAppReminder({ phone: '71234567', firstName: 'Ana', businessName: 'Empyrean Studio', appointment: { startsAt: '2026-10-19T18:00:00Z', serviceName: 'Corte', barberName: 'Andy' } });
    assert.equal(captured.options.body.get('To'), 'whatsapp:+59171234567');
    assert.equal(captured.options.body.get('From'), 'whatsapp:+14155238886');
    assert.equal(captured.options.body.get('ContentSid'), 'HXtest');
    assert.equal(JSON.parse(captured.options.body.get('ContentVariables'))['3'], 'Corte');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
  }
});

test('envía la plantilla de prueba de Meta sin exponer el token', async () => {
  const keys = ['WHATSAPP_PROVIDER', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_TEMPLATE_NAME', 'META_WHATSAPP_TEMPLATE_LANGUAGE', 'META_WHATSAPP_TEMPLATE_USES_PARAMETERS', 'META_WHATSAPP_GRAPH_VERSION'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { WHATSAPP_PROVIDER: 'meta', META_WHATSAPP_PHONE_NUMBER_ID: '12345', META_WHATSAPP_ACCESS_TOKEN: 'secret', META_WHATSAPP_TEMPLATE_NAME: 'hello_world', META_WHATSAPP_TEMPLATE_LANGUAGE: 'en_US', META_WHATSAPP_TEMPLATE_USES_PARAMETERS: 'false', META_WHATSAPP_GRAPH_VERSION: 'v21.0' });
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url, options }; return { ok: true }; };
  try {
    await sendWhatsAppReminder({ phone: '71234567', firstName: 'Ana', businessName: 'Empyrean Studio', appointment: { startsAt: '2026-10-19T18:00:00Z', serviceName: 'Corte', barberName: 'Andy' } });
    assert.match(captured.url, /graph\.facebook\.com\/v21\.0\/12345\/messages/);
    assert.equal(captured.options.headers.Authorization, 'Bearer secret');
    assert.deepEqual(JSON.parse(captured.options.body), { messaging_product: 'whatsapp', to: '59171234567', type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
  }
});

test('no envía WhatsApp si el cliente retiró su consentimiento', async () => {
  const keys = ['WHATSAPP_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WHATSAPP_CONTENT_SID'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { WHATSAPP_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'secret', TWILIO_WHATSAPP_FROM: '+14155238886', TWILIO_WHATSAPP_CONTENT_SID: 'HXtest' });
  const originalGetConnection = pool.getConnection;
  const originalFetch = globalThis.fetch;
  const queries = [];
  let sent = false;
  globalThis.fetch = async () => { sent = true; return { ok: true }; };
  pool.getConnection = async () => ({
    execute: async (sql) => {
      queries.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('SELECT r.id')) return [[{ id: 3, appointmentId: 9, channel: 'WHATSAPP', firstName: 'Ana' }]];
      if (sql.includes('SELECT a.status')) return [[{ status: 'CONFIRMED', future: 1, consent: null, phone: '+59171234567' }]];
      return [{}];
    },
    release() {}
  });
  try {
    await processDueReminders();
    assert.equal(sent, false);
    assert.ok(queries.some((sql) => sql.includes("status = 'CANCELLED'") && sql.includes('sin consentimiento')));
  } finally {
    pool.getConnection = originalGetConnection;
    globalThis.fetch = originalFetch;
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
  }
});
