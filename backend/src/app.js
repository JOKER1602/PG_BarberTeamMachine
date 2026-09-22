import cors from 'cors';
import express from 'express';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import barberPortalRouter from './routes/barber-portal.js';
import appointmentsRouter from './routes/appointments.js';
import barbersRouter from './routes/barbers.js';
import { handleError, notFound } from './middleware/errors.js';
import notificationsRouter from './routes/notifications.js';
import servicesRouter from './routes/services.js';
import settingsRouter from './routes/settings.js';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/barber', barberPortalRouter);
app.use('/api/services', servicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/barbers', barbersRouter);
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
