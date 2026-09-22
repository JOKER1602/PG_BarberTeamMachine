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

export function isEmailConfigured() {
  return Boolean(smtpConfiguration());
}

export async function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  const config = smtpConfiguration();
  if (!config) throw new Error('El correo SMTP no está configurado');

  const transport = nodemailer.createTransport(config);
  await transport.sendMail({
    from: config.from,
    to,
    subject: 'Restablece tu contraseña | Barber Team Machine',
    text: `Hola ${firstName || ''},\n\nSolicitaste restablecer tu contraseña. Usa este enlace dentro de los próximos 30 minutos:\n${resetUrl}\n\nSi no hiciste esta solicitud, puedes ignorar este correo.`,
    html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#151515">
      <p style="font-size:12px;letter-spacing:1.5px;color:#3569ee;font-weight:700">BARBER TEAM MACHINE</p>
      <h1 style="font-size:26px">Restablece tu contraseña</h1>
      <p>Hola ${firstName || ''}, recibimos una solicitud para cambiar la contraseña de tu cuenta.</p>
      <p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;padding:14px 22px;background:#3569ee;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Crear nueva contraseña</a></p>
      <p style="color:#5e626d;font-size:13px">Este enlace vence en 30 minutos. Si no solicitaste el cambio, puedes ignorar este correo.</p>
    </main>`
  });
}
