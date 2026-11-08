import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/services/email.js';

test('escapa el HTML de los datos que se insertan en los correos', () => {
  assert.equal(escapeHtml('<a href="x">Ana & \'Luis\'</a>'), '&lt;a href=&quot;x&quot;&gt;Ana &amp; &#39;Luis&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml('José Pérez'), 'José Pérez');
});

import { emailProvider, parseSender, sendEmail } from '../src/services/email.js';

const EMAIL_VARS = ['RESEND_API_KEY', 'BREVO_API_KEY', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM'];
async function withEmailEnv(values, callback) {
  const previous = Object.fromEntries(EMAIL_VARS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const key of EMAIL_VARS) delete process.env[key];
  Object.assign(process.env, values);
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; };
  try { return await callback(requests); } finally {
    globalThis.fetch = originalFetch;
    for (const key of EMAIL_VARS) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
}
const message = { to: 'cliente@test.local', subject: 'Asunto', text: 'Texto', html: '<p>Texto</p>' };

test('interpreta el remitente "Nombre <correo>"', () => {
  assert.deepEqual(parseSender('Reservas <hola@reservas.test>'), { name: 'Reservas', email: 'hola@reservas.test' });
  assert.deepEqual(parseSender('"Barbería Norte" <norte@reservas.test>'), { name: 'Barbería Norte', email: 'norte@reservas.test' });
  assert.deepEqual(parseSender('solo@reservas.test'), { email: 'solo@reservas.test' });
});

test('envía por la API HTTPS de Resend cuando hay RESEND_API_KEY', async () => {
  await withEmailEnv({ RESEND_API_KEY: 're_prueba', EMAIL_FROM: 'Reservas <hola@reservas.test>', EMAIL_HOST: 'smtp.test' }, async (requests) => {
    assert.equal(emailProvider(), 'resend', 'la API tiene prioridad sobre SMTP');
    await sendEmail(message);
    assert.equal(requests[0].url, 'https://api.resend.com/emails');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer re_prueba');
    assert.deepEqual(requests[0].body, { from: 'Reservas <hola@reservas.test>', to: ['cliente@test.local'], subject: 'Asunto', text: 'Texto', html: '<p>Texto</p>' });
  });
});

test('envía por la API HTTPS de Brevo cuando hay BREVO_API_KEY', async () => {
  await withEmailEnv({ BREVO_API_KEY: 'xkeysib-prueba', EMAIL_FROM: 'Reservas <hola@reservas.test>' }, async (requests) => {
    assert.equal(emailProvider(), 'brevo');
    await sendEmail(message);
    assert.equal(requests[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(requests[0].options.headers['api-key'], 'xkeysib-prueba');
    assert.deepEqual(requests[0].body, { sender: { name: 'Reservas', email: 'hola@reservas.test' }, to: [{ email: 'cliente@test.local' }], subject: 'Asunto', textContent: 'Texto', htmlContent: '<p>Texto</p>' });
  });
});

test('sin proveedor configurado no envía y lo informa', async () => {
  await withEmailEnv({}, async (requests) => {
    assert.equal(emailProvider(), null);
    await assert.rejects(sendEmail(message), /no está configurado/);
    assert.equal(requests.length, 0);
  });
});

test('un rechazo del proveedor se informa con su detalle', async () => {
  await withEmailEnv({ RESEND_API_KEY: 're_prueba', EMAIL_FROM: 'a@b.test' }, async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'dominio no verificado' }) });
    await assert.rejects(sendEmail(message), /Resend rechazó el correo \(HTTP 403\): dominio no verificado/);
  });
});
