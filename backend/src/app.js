import cors from 'cors';
import express from 'express';
import path from 'node:path';
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
import assistantRouter from './routes/assistant.js';
import { resolveDefaultTenant, resolveTenant } from './middleware/tenant.js';

const app = express();
// Solo se habilita cuando el servidor está detrás de un proxy HTTPS confiable.
// Así request.protocol conserva https al generar URLs públicas de fotos y QR.
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
app.use('/uploads/barbers', express.static(path.resolve(process.cwd(), 'uploads', 'barbers')));
app.use('/uploads/qr', express.static(path.resolve(process.cwd(), 'uploads', 'qr')));
// Mantiene visibles QR cargados antes de la separación, sin exponer proofs.
app.use('/uploads/payments', (request, response, next) => {
  if (!/^\/qr-[\w-]+\.(?:jpe?g|png|webp)$/i.test(request.path)) return next();
  return express.static(path.resolve(process.cwd(), 'uploads', 'payments'))(request, response, next);
});

// SaaS · Incremento 2. Los módulos ya aislados por tenant_id se publican en
// /api/t/:tenantSlug/... y, durante la transición, también en /api/... para la
// barbería por defecto (DEFAULT_TENANT_SLUG), así el frontend actual sigue igual.
// Un módulo SOLO entra en tenantApi cuando todas sus consultas filtran por
// tenant: lo que aún no está aislado nunca debe poder pedirse con otro slug.
const tenantApi = express.Router();
tenantApi.use('/services', servicesRouter);
tenantApi.use('/barbers', barbersRouter);
tenantApi.use('/settings', settingsRouter);
app.use('/api/t/:tenantSlug', resolveTenant, tenantApi);

app.use('/api/auth', authRouter);
// Aún no aislado por completo (panel y usuarios): solo barbería por defecto.
// (adminRouter resuelve la barbería por defecto después de autenticar).
app.use('/api/admin', adminRouter);
app.use('/api/barber', barberPortalRouter);
app.use(['/api/services', '/api/barbers', '/api/settings'], resolveDefaultTenant);
app.use('/api', tenantApi);
app.use('/api/reviews', reviewsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/notifications', notificationsRouter);

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'barber-team-machine-api',
    timestamp: new Date().toISOString()
  });
});

app.use(notFound);
app.use(handleError);

export default app;
