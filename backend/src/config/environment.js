function hasPlaceholder(value) {
  return !value || /replace-with|changeme|example|default-secret/i.test(value);
}

function databaseCredentials() {
  if (!process.env.DATABASE_URL) return { user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD };
  try {
    const url = new URL(process.env.DATABASE_URL);
    return { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  } catch {
    return {};
  }
}

function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];
  const jwtSecret = process.env.JWT_SECRET;
  if (hasPlaceholder(jwtSecret) || jwtSecret.length < 32) {
    errors.push('JWT_SECRET debe ser aleatorio y tener al menos 32 caracteres.');
  }
  const connection = databaseCredentials();
  if (!connection.password) errors.push('La contraseña de la base de datos es obligatoria en producción (DATABASE_URL o DATABASE_PASSWORD).');
  // El usuario del pooler de Supabase es "usuario.ref-del-proyecto".
  if (/^(postgres|supabase_admin|root)(\.|$)/.test(connection.user ?? '')) errors.push('La API no puede conectarse con un usuario administrador (postgres); usa el usuario propio que crea el migrador.');

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
