import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { customers } from './routes/customers.js';
import { products } from './routes/products.js';
import { licenses } from './routes/licenses.js';
import { calendar } from './routes/calendar.js';
import { scheduleReminders } from './jobs/reminders.js';

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json());

// Simple header-based auth passthrough (z. B. Authentik/Reverse Proxy)
app.use((req, _res, next) => {
  req.user = {
    email: req.get('X-User-Email') || req.get('X-Forwarded-Email') || 'local@anonymous',
    name: req.get('X-User-Name') || undefined
  };
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api/customers', customers);
app.use('/api/products', products);
app.use('/api/licenses', licenses);
app.use('/calendar', calendar);

// Friendly details page (MVP)
app.get('/licenses/:public_id', (_req, res) => {
  res.send(`<html><body><h2>Lizenzdetails</h2><p>Diese URL ist für die API vorgesehen. Nutze die REST-Endpunkte oder baue ein UI.</p></body></html>`);
});

// Start
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Licenses API running on :${port}`);
});

// Jobs
scheduleReminders();
