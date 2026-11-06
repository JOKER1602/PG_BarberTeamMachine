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

export function validateEnvironment() {
  assertProductionConfiguration();
}
