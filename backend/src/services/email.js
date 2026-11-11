import nodemailer from 'nodemailer';

function smtpConfiguration() {
  const required = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) return null;

  return {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: String(process.env.EMAIL_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
    from: process.env.EMAIL_FROM
  };
}

// Nombres, servicios y datos del negocio los escriben usuarios o administradores.
// Se escapan antes de insertarlos en el HTML del correo.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

// Proveedor de correo, en este orden:
//   RESEND_API_KEY  → API HTTPS de Resend
//   BREVO_API_KEY   → API HTTPS de Brevo
//   EMAIL_HOST...   → SMTP
// Las API HTTPS funcionan donde el SMTP saliente está bloqueado (Railway lo
// bloquea en los planes Free, Trial y Hobby). Todas usan EMAIL_FROM como
// remitente: "Nombre <correo@dominio-verificado>".
export function emailProvider() {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return 'resend';
  if (process.env.BREVO_API_KEY && process.env.EMAIL_FROM) return 'brevo';
  return smtpConfiguration() ? 'smtp' : null;
}

export function isEmailConfigured() {
  return Boolean(emailProvider());
}

export function parseSender(from) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from ?? '');
  return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: String(from ?? '').trim() };
}

async function postJson(url, headers, body, label) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`${label} rechazó el correo (HTTP ${response.status})${detail?.message ? `: ${detail.message}` : ''}`);
  }
}

// Punto único de envío: el resto del código no conoce el proveedor.
export async function sendEmail({ to, subject, text, html }) {
  const provider = emailProvider();
  if (provider === 'resend') {
    return postJson('https://api.resend.com/emails', { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from: process.env.EMAIL_FROM, to: [to], subject, text, html }, 'Resend');
  }
  if (provider === 'brevo') {
    return postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': process.env.BREVO_API_KEY },
      { sender: parseSender(process.env.EMAIL_FROM), to: [{ email: to }], subject, textContent: text, htmlContent: html }, 'Brevo');
  }
  if (provider === 'smtp') {
    const config = smtpConfiguration();
    return nodemailer.createTransport(config).sendMail({ from: config.from, to, subject, text, html });
  }
  throw new Error('El correo no está configurado');
}

// La cuenta es global; el correo lleva la marca de la barbería desde la que
// se pidió el cambio (o PLATFORM_NAME si se pidió fuera de una barbería).
export async function sendPasswordResetEmail({ to, firstName, resetUrl, brandName }) {
  const brand = brandName || process.env.PLATFORM_NAME || 'Reservas de barbería';
  await sendEmail({
    to,
    subject: `Restablece tu contraseña | ${brand}`,
    text: `Hola ${firstName || ''},\n\nSolicitaste restablecer tu contraseña. Usa este enlace dentro de los próximos 30 minutos:\n${resetUrl}\n\nSi no hiciste esta solicitud, puedes ignorar este correo.`,
    html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#151515">
      <p style="font-size:12px;letter-spacing:1.5px;color:#3569ee;font-weight:700">${escapeHtml(brand).toUpperCase()}</p>
      <h1 style="font-size:26px">Restablece tu contraseña</h1>
      <p>Hola ${escapeHtml(firstName)}, recibimos una solicitud para cambiar la contraseña de tu cuenta.</p>
      <p style="margin:28px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:14px 22px;background:#3569ee;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Crear nueva contraseña</a></p>
      <p style="color:#5e626d;font-size:13px">Este enlace vence en 30 minutos. Si no solicitaste el cambio, puedes ignorar este correo.</p>
    </main>`
  });
}

export async function sendAppointmentReminderEmail({ to, firstName, appointment, business }) {
  const when = new Date(appointment.startsAt).toLocaleString('es-BO', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/La_Paz' });
  const safe = {
    firstName: escapeHtml(firstName), serviceName: escapeHtml(appointment.serviceName), barberName: escapeHtml(appointment.barberName),
    businessName: escapeHtml(business.businessName), address: escapeHtml(business.address), city: escapeHtml(business.city),
    phone: escapeHtml(business.phone), when: escapeHtml(when)
  };
  await sendEmail({
    to,
    subject: `Recordatorio de cita | ${business.businessName}`,
    text: `Hola ${firstName}, te recordamos tu cita de ${appointment.serviceName} con ${appointment.barberName} el ${when}. Dirección: ${business.address}, ${business.city}.`,
    html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#151515"><p style="font-size:12px;letter-spacing:1.5px;color:#3569ee;font-weight:700">${safe.businessName}</p><h1 style="font-size:26px">Recordatorio de tu cita</h1><p>Hola ${safe.firstName}, tienes una cita próxima.</p><p><b>${safe.serviceName}</b><br/>Con ${safe.barberName}<br/>${safe.when}</p><p style="color:#5e626d">${safe.address}, ${safe.city} · ${safe.phone}</p></main>`
  });
}
