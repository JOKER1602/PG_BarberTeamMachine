function hasPlaceholder(value) {
  return !value || /replace-with|changeme|example|default-secret/i.test(value);
}

function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];
  const jwtSecret = process.env.JWT_SECRET;
  if (hasPlaceholder(jwtSecret) || jwtSecret.length < 32) {
    errors.push('JWT_SECRET debe ser aleatorio y tener al menos 32 caracteres.');
  }
  if (!process.env.DATABASE_PASSWORD) errors.push('DATABASE_PASSWORD es obligatorio en producción.');
  if (process.env.DATABASE_USER === 'root') errors.push('DATABASE_USER no puede ser root en producción.');

  const origins = (process.env.FRONTEND_URL ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length) {
    errors.push('FRONTEND_URL debe indicar el dominio HTTPS del frontend.');
  } else {
    for (const origin of origins) {
      try {
        if (new URL(origin).protocol !== 'https:') errors.push(`FRONTEND_URL debe usar HTTPS: ${origin}`);
      } catch {
        errors.push(`FRONTEND_URL no es una URL válida: ${origin}`);
      }
    }
  }

  if (errors.length > 0) throw new Error(`Configuración de producción insegura:\n- ${errors.join('\n- ')}`);
}

// Avisos que no impiden arrancar pero sí afectan a las barberías.
function warnProductionGaps() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.UPLOADS_DIR) console.warn('AVISO: UPLOADS_DIR no está definido; fotos, QR y comprobantes se perderán al redeplegar si el disco no es persistente.');
  if (!process.env.RESEND_API_KEY && !process.env.BREVO_API_KEY && !process.env.EMAIL_HOST) {
    console.warn('AVISO: el correo no está configurado (RESEND_API_KEY, BREVO_API_KEY o SMTP); no habrá recuperación de contraseña ni recordatorios por correo.');
  }
  if (process.env.TRUST_PROXY !== 'true') console.warn('AVISO: TRUST_PROXY no está activo; detrás de un proxy, el límite de intentos verá la IP del proxy.');
}

export function validateEnvironment() {
  assertProductionConfiguration();
  warnProductionGaps();
}
