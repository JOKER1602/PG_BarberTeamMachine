import 'dotenv/config';
import app from './app.js';
import { validateEnvironment } from './config/environment.js';
import { startReminderWorker } from './services/reminders.js';

validateEnvironment();
const port = Number(process.env.PORT ?? 3000);

app.listen(port, '0.0.0.0', () => {
  console.log(`API disponible en http://localhost:${port}`);
  startReminderWorker();
});
