// Límite de intentos en memoria (ventana fija por clave).
//
// Protege inicio de sesión, registro, recuperación de contraseña y subidas
// contra fuerza bruta y abuso. Funciona por instancia: es suficiente con un
// solo servidor de API (el despliegue recomendado para las primeras
// barberías). Si se ejecutan varias instancias, mover el contador a Redis o al
// proxy (p. ej. reglas de Cloudflare) para que el límite sea compartido.
//
// La IP sale de request.ip: detrás de un proxy HTTPS se debe usar
// TRUST_PROXY=true para que sea la del cliente y no la del proxy.

// CLIENT_IP_HEADER: cabecera que el proxy de entrada SOBRESCRIBE con la IP real
// del cliente (en Railway, x-real-ip). Úsala solo si todo el tráfico llega por
// ese proxy; si no se define, se usa request.ip (TRUST_PROXY).
export function clientIp(request) {
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (header) {
    const value = request.get?.(header) ?? request.headers?.[header];
    const first = String(value ?? '').split(',')[0].trim();
    if (first) return first;
  }
  return request.ip || request.socket?.remoteAddress || 'desconocida';
}

export function createRateLimit({ windowMs, max, key, message = 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [entryKey, entry] of hits) if (entry.resetAt <= now) hits.delete(entryKey);
  }, windowMs);
  sweep.unref?.();

  function limiter(request, response, next) {
    if (process.env.RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production') return next();
    const entryKey = key(request);
    if (!entryKey) return next();
    const now = Date.now();
    let entry = hits.get(entryKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(entryKey, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      response.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return response.status(429).json({ message });
    }
    return next();
  }
  limiter.reset = () => hits.clear();
  return limiter;
}

const MINUTE = 60_000;
const normalizedEmail = (request) => String(request.body?.email ?? '').toLowerCase().trim();

// Valores pensados para personas reales: holgados para quien se equivoca,
// insuficientes para probar contraseñas o enviar correos masivos.
export const loginLimiters = [
  createRateLimit({ windowMs: 15 * MINUTE, max: 10, key: (request) => `login:${clientIp(request)}:${normalizedEmail(request)}` }),
  createRateLimit({ windowMs: 15 * MINUTE, max: 50, key: (request) => `login-ip:${clientIp(request)}` })
];
export const registerLimiter = createRateLimit({ windowMs: 60 * MINUTE, max: 10, key: (request) => `register:${clientIp(request)}` });
export const passwordResetLimiters = [
  createRateLimit({ windowMs: 15 * MINUTE, max: 5, key: (request) => `forgot-ip:${clientIp(request)}` }),
  createRateLimit({ windowMs: 60 * MINUTE, max: 3, key: (request) => normalizedEmail(request) && `forgot-email:${normalizedEmail(request)}` })
];
export const resetPasswordLimiter = createRateLimit({ windowMs: 15 * MINUTE, max: 10, key: (request) => `reset:${clientIp(request)}` });
export const changePasswordLimiter = createRateLimit({ windowMs: 15 * MINUTE, max: 10, key: (request) => `change-password:${request.auth?.sub ?? clientIp(request)}` });
export const uploadLimiter = createRateLimit({ windowMs: 60 * MINUTE, max: 30, key: (request) => `upload:${request.auth?.sub ?? clientIp(request)}`, message: 'Subiste demasiados archivos. Intenta más tarde.' });
export const assistantLimiter = createRateLimit({ windowMs: MINUTE, max: 30, key: (request) => `assistant:${clientIp(request)}` });
