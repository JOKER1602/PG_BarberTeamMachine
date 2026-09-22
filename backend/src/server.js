import 'dotenv/config';
import app from './app.js';
import { startReminderWorker } from './services/reminders.js';

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`API disponible en http://localhost:${port}`);
  startReminderWorker();
});
