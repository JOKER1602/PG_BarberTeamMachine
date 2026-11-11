import 'dotenv/config';
import app from './app.js';
import pool from './config/database.js';
import { validateEnvironment } from './config/environment.js';
import { startReminderWorker } from './services/reminders.js';
import { startPaymentProofCleanup } from './services/payment-proof-retention.js';

validateEnvironment();
const port = Number(process.env.PORT ?? 3000);
let stopReminders = () => {};
let stopProofCleanup = () => {};

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`API disponible en http://localhost:${port}`);
  stopReminders = startReminderWorker();
  stopProofCleanup = startPaymentProofCleanup();
});

// Al redeplegar, el proveedor envía SIGTERM: se dejan de aceptar conexiones,
// se terminan las peticiones en curso y se cierra la base antes de salir.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recibido: cerrando la API...`);
  stopReminders();
  stopProofCleanup();
  const forceExit = setTimeout(() => { console.error('Cierre forzado tras 10 s'); process.exit(1); }, 10_000);
  forceExit.unref();
  server.close(() => {
    pool.end().catch(() => {}).finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('Promesa rechazada sin manejar:', reason));
