import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import barberPortalRouter from './routes/barber-portal.js';
import appointmentsRouter from './routes/appointments.js';
import barbersRouter from './routes/barbers.js';
import { handleError, notFound } from './middleware/errors.js';
import notificationsRouter from './routes/notifications.js';
import servicesRouter from './routes/services.js';
import settingsRouter from './routes/settings.js';
import reviewsRouter from './routes/reviews.js';
import paymentsRouter from './routes/payments.js';
import recommendationsRouter from './routes/recommendations.js';
import platformRouter from './routes/platform.js';
import { resolveDefaultTenant, resolveTenant } from './middleware/tenant.js';
import pool from './config/database.js';
import { uploadsPath } from './config/paths.js';

const app = express();
// Solo se habilita cuando el servidor está detrás de un proxy HTTPS confiable.
// Así request.ip es la del cliente (límite de intentos) y request.protocol es https.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const configuredFrontends = new Set(
  (process.env.FRONTEND_URL ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
);
const isAllowedDevelopmentOrigin = (origin) => {
  if (!origin) return true;
  if (configuredFrontends.has(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;

  // Vite puede abrirse por localhost, 127.0.0.1 o la IP privada de la red.
  // Se limita al puerto del frontend para no aceptar orígenes arbitrarios.
  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):5173$/.test(origin);
};

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    callback(null, isAllowedDevelopmentOrigin(origin));
  }
}));
// Complementa SameSite=Lax: un origen ajeno no puede realizar cambios usando
// la sesión del cliente, incluso si intenta enviar cookies manualmente.
app.use((request, response, next) => {
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const origin = request.get('origin');
  if (!isSafeMethod && origin && !isAllowedDevelopmentOrigin(origin)) {
    return response.status(403).json({ message: 'Origen no autorizado' });
  }
  return next();
});
app.use(express.json({ limit: '1mb' }));
// Solo fotos públicas de profesionales y QR se exponen como archivos estáticos.
// Los comprobantes se sirven por una ruta autenticada de pagos.
app.use('/uploads/barbers', express.static(uploadsPath('barbers')));
app.use('/uploads/qr', express.static(uploadsPath('qr')));
app.use('/uploads/brand', express.static(uploadsPath('brand')));
// Mantiene visibles QR cargados antes de la separación, sin exponer proofs.
app.use('/uploads/payments', (request, response, next) => {
  if (!/^\/qr-[\w-]+\.(?:jpe?g|png|webp)$/i.test(request.path)) return next();
  return express.static(uploadsPath('payments'))(request, response, next);
});

// SaaS multiempresa. Todos los módulos de negocio filtran por tenant_id y se
// publican en /api/t/:tenantSlug/... Durante la transición del frontend, las
// rutas antiguas /api/... atienden a la barbería DEFAULT_TENANT_SLUG.
// Solo /api/auth y /api/health son globales (las cuentas son de la persona).
const tenantModules = {
  '/services': servicesRouter,
  '/barbers': barbersRouter,
  '/settings': settingsRouter,
  '/admin': adminRouter,
  '/barber': barberPortalRouter,
  '/appointments': appointmentsRouter,
  '/payments': paymentsRouter,
  '/reviews': reviewsRouter,
  '/notifications': notificationsRouter,
  '/recommendations': recommendationsRouter
};
export const TENANT_MODULE_PATHS = Object.freeze(Object.keys(tenantModules));
const tenantApi = express.Router();
for (const [prefix, router] of Object.entries(tenantModules)) tenantApi.use(prefix, router);

// Datos públicos mínimos de la barbería: el frontend los usa para saber si un
// slug existe (404) o está suspendido (403) antes de mostrar la página.
// Incluye la marca (nombre comercial, ciudad, logo y portada) para que el
// frontend muestre la identidad de cada barbería y no la de otra.
app.get('/api/t/:tenantSlug', resolveTenant, async (request, response, next) => {
  try {
    const { id, slug, displayName } = request.tenant;
    const [rows] = await pool.execute(
      'SELECT business_name AS "businessName", city, logo_url AS "logoUrl", cover_url AS "coverUrl" FROM tenant_settings WHERE tenant_id = ?',
      [id]
    );
    const settings = rows[0] ?? {};
    return response.json({
      tenant: { slug, displayName },
      brand: { name: settings.businessName || displayName, city: settings.city ?? null, logoUrl: settings.logoUrl ?? null, coverUrl: settings.coverUrl ?? null }
    });
  } catch (error) { return next(error); }
});
app.use('/api/t/:tenantSlug', resolveTenant, tenantApi);
app.use('/api/auth', authRouter);
// Operadores de la plataforma: alta y estado de barberías (global, sin slug).
app.use('/api/platform', platformRouter);
app.use(TENANT_MODULE_PATHS.map((prefix) => `/api${prefix}`), resolveDefaultTenant);
app.use('/api', tenantApi);

// Vida del proceso (para el proveedor de hosting): no toca la base.
app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'barber-team-machine-api',
    timestamp: new Date().toISOString()
  });
});

// Listo para atender: la base responde y tiene el esquema aplicado.
// Úsalo en el monitor de disponibilidad.
app.get('/api/health/ready', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    const [rows] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'tenants') AS "hasTenants",
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'appointments' AND column_name = 'tenant_id') AS "hasTenantIds",
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tenant_settings' AND column_name = 'logo_url') AS "hasBranding"`
    );
    const missing = Object.entries({ tenants: rows[0].hasTenants, tenant_id: rows[0].hasTenantIds, marca: rows[0].hasBranding })
      .filter(([, present]) => !Number(present)).map(([migration]) => migration);
    if (missing.length) return response.status(503).json({ ok: false, database: 'up', missingMigrations: missing });
    return response.json({ ok: true, database: 'up' });
  } catch {
    return response.status(503).json({ ok: false, database: 'down' });
  }
});

// Frontend compilado servido por la misma API (un solo servicio en producción).
// Se activa con SERVE_FRONTEND=true después de `npm run build`. Las rutas
// /t/:slug, /platform, etc. devuelven index.html (la SPA decide la página).
const frontendDist = path.resolve(process.env.FRONTEND_DIST || fileURLToPath(new URL('../../frontend/dist', import.meta.url)));
if (process.env.SERVE_FRONTEND === 'true') {
  if (!existsSync(path.join(frontendDist, 'index.html'))) {
    throw new Error(`SERVE_FRONTEND=true pero no existe ${path.join(frontendDist, 'index.html')}. Ejecuta npm run build.`);
  }
  // Política de contenido: solo recursos propios, más el mapa de Google
  // incrustado. Las imágenes pueden venir de cualquier HTTPS (logos, fotos).
  const contentSecurityPolicy = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
    "font-src 'self' data:", "connect-src 'self'", 'frame-src https://maps.google.com https://www.google.com',
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; ');
  const frontendHeaders = (response) => {
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  };
  // Los archivos con hash en el nombre se cachean un año; index.html nunca,
  // para que cada despliegue llegue de inmediato.
  app.use(express.static(frontendDist, {
    index: false,
    setHeaders: (response, filePath) => {
      frontendHeaders(response);
      response.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  }));
  // /assets inexistente → 404 (no la página): evita servir HTML como JavaScript.
  app.get(/^(?!\/(?:api|uploads|assets)(?:\/|$)).*/, (_request, response) => {
    frontendHeaders(response);
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFound);
app.use(handleError);

export default app;
