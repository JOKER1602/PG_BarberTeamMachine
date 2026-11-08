export function normalizeBolivianPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const local = digits.startsWith('591') ? digits.slice(3) : digits;
  if (!/^[67]\d{7}$/.test(local)) throw new Error('Se requiere un número móvil boliviano válido de 8 dígitos');
  return `+591${local}`;
}

function twilioConfiguration() {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_WHATSAPP_FROM: from, TWILIO_WHATSAPP_CONTENT_SID: contentSid } = process.env;
  return accountSid && authToken && from && contentSid ? { accountSid, authToken, from, contentSid } : null;
}

function metaConfiguration() {
  const {
    META_WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
    META_WHATSAPP_ACCESS_TOKEN: accessToken,
    META_WHATSAPP_TEMPLATE_NAME: templateName = 'hello_world',
    META_WHATSAPP_TEMPLATE_LANGUAGE: templateLanguage = 'en_US',
    META_WHATSAPP_TEMPLATE_USES_PARAMETERS: usesParameters = 'false',
    META_WHATSAPP_GRAPH_VERSION: graphVersion = 'v21.0'
  } = process.env;
  return phoneNumberId && accessToken
    ? { phoneNumberId, accessToken, templateName, templateLanguage, usesParameters: usesParameters === 'true', graphVersion }
    : null;
}

function provider() {
  const selected = String(process.env.WHATSAPP_PROVIDER ?? '').trim().toLowerCase();
  if (selected === 'meta') return metaConfiguration() ? 'meta' : null;
  if (selected === 'twilio') return twilioConfiguration() ? 'twilio' : null;
  if (metaConfiguration()) return 'meta';
  return twilioConfiguration() ? 'twilio' : null;
}

export function isWhatsAppConfigured() {
  return Boolean(provider());
}

function appointmentTime(appointment) {
  return new Date(appointment.startsAt).toLocaleString('es-BO', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/La_Paz' });
}

async function sendWithTwilio({ phone, firstName, appointment, businessName }) {
  const config = twilioConfiguration();
  if (!config) throw new Error('Twilio para WhatsApp no está configurado');
  const when = new Date(appointment.startsAt).toLocaleString('es-BO', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/La_Paz' });
  const body = new URLSearchParams({
    From: config.from.startsWith('whatsapp:') ? config.from : `whatsapp:${config.from}`,
    To: `whatsapp:${phone}`,
    ContentSid: config.contentSid,
    ContentVariables: JSON.stringify({ 1: firstName || 'cliente', 2: businessName, 3: appointment.serviceName, 4: appointment.barberName, 5: when })
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(`WhatsApp no pudo aceptar el mensaje (HTTP ${response.status}${result.code ? `, código ${result.code}` : ''})`);
  }
}

async function sendWithMeta({ phone, firstName, appointment, businessName }) {
  const config = metaConfiguration();
  if (!config) throw new Error('Meta WhatsApp Cloud API no está configurada');
  const template = { name: config.templateName, language: { code: config.templateLanguage } };
  if (config.usesParameters) {
    template.components = [{
      type: 'body',
      parameters: [
        { type: 'text', text: firstName || 'cliente' },
        { type: 'text', text: businessName || 'tu barbería' },
        { type: 'text', text: appointment.serviceName || 'tu servicio' },
        { type: 'text', text: appointment.barberName || 'tu profesional' },
        { type: 'text', text: appointmentTime(appointment) }
      ]
    }];
  }
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(config.graphVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: 'template', template }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const detail = result?.error?.message ? `: ${result.error.message}` : '';
    throw new Error(`Meta WhatsApp no pudo aceptar el mensaje (HTTP ${response.status})${detail}`);
  }
}

// Cloud API usa plantillas aprobadas fuera de la ventana de conversación de 24 h.
export async function sendWhatsAppReminder({ phone, firstName, appointment, businessName }) {
  const normalizedPhone = normalizeBolivianPhone(phone);
  const selectedProvider = provider();
  if (selectedProvider === 'meta') return sendWithMeta({ phone: normalizedPhone, firstName, appointment, businessName });
  if (selectedProvider === 'twilio') return sendWithTwilio({ phone: normalizedPhone, firstName, appointment, businessName });
  throw new Error('WhatsApp no está configurado');
}
