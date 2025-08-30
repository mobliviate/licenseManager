import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import dayjs from 'dayjs';
import { ulid } from 'ulid';

// API + Jobs
import { customers as apiCustomers } from './routes/customers.js';
import { products as apiProducts }   from './routes/products.js';
import { licenses as apiLicenses }   from './routes/licenses.js';
import { calendar } from './routes/calendar.js';
import { scheduleReminders } from './jobs/reminders.js';
import { pool } from './db.js';

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

/* --- Reverse-Proxy / SSO passthrough --- */
app.use((req, _res, next) => {
  req.user = {
    email: req.get('X-User-Email') || req.get('X-Forwarded-Email') || 'local@anonymous',
    name: req.get('X-User-Name') || undefined
  };
  next();
});

/* --- Helpers --- */
function esc(v = '') {
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function reqUser() { return (globalThis.__lastUserEmail || ''); }
function layout(title, body) {
  const icsUrl = process.env.ICS_TOKEN ? `/calendar/${esc(process.env.ICS_TOKEN)}` : null;
  return `<!doctype html>
  <html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)} · Lizenzmanager</title>
    <style>
      :root { --bg:#0b1020; --card:#131b34; --muted:#8fa3c7; --fg:#e9eef9; --acc:#4c82ff; }
      html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial;}
      a{color:var(--acc);text-decoration:none}
      .wrap{max-width:1100px;margin:0 auto;padding:24px}
      header{display:flex;align-items:center;gap:16px;margin-bottom:16px}
      nav a{margin-right:12px}
      .btn{display:inline-block;padding:8px 12px;border-radius:10px;background:#1d2a52;color:var(--fg)}
      .btn.primary{background:var(--acc);color:white}
      .row{display:flex;gap:16px;flex-wrap:wrap}
      .card{background:var(--card);border-radius:14px;padding:16px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset}
      table{width:100%;border-collapse:collapse}
      th,td{padding:8px 10px;border-bottom:1px solid #1e2a4d}
      th{text-align:left;color:var(--muted);font-weight:600}
      tbody tr:hover{background:#0f1730}
      .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#203160;color:#cfe0ff;font-size:12px}
      .pill.ok{background:#1f4d2f;color:#c9f3d2}
      .pill.warn{background:#5a3b12;color:#ffe5c2}
      .pill.danger{background:#5b1f2a;color:#ffd0db}
      form .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      input,select,textarea{width:100%;padding:8px 10px;border-radius:10px;border:1px solid #30406f;background:#0f1730;color:var(--fg)}
      label{display:block;margin:8px 0 4px;color:var(--muted)}
      .hint{color:var(--muted)}
      .badge{background:#203160;border:1px solid #3a4f8a;border-radius:8px;padding:6px 8px}
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <h2 style="margin:0">🧩 Lizenzmanager</h2>
        <nav>
          <a href="/">Dashboard</a>
          <a href="/customers">Kunden</a>
          <a href="/products">Produkte</a>
          <a href="/licenses">Lizenzen</a>
          ${icsUrl ? `<a class="badge" href="${icsUrl}">iCal-Feed</a>` : ''}
        </nav>
        <div style="margin-left:auto" class="hint">${esc(reqUser())}</div>
      </header>
      ${body}
    </div>
  </body>
  </html>`;
}

// Keep user email for header display
app.use((req, _res, next) => { globalThis.__lastUserEmail = req.user?.email || ''; next(); });

/* ========================= API Mounts ========================= */
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api/customers', apiCustomers);
app.use('/api/products',  apiProducts);
app.use('/api/licenses',  apiLicenses);
app.use('/calendar',      calendar);

/* ========================= UI ROUTES ========================= */

// Dashboard
app.get('/', async (_req, res) => {
  const [cRows] = await pool.query('SELECT COUNT(*) AS c_cnt FROM customers');
  const [pRows] = await pool.query('SELECT COUNT(*) AS p_cnt FROM products');
  const [lRows] = await pool.query('SELECT COUNT(*) AS l_cnt FROM licenses');
  const c_cnt = cRows[0].c_cnt, p_cnt = pRows[0].p_cnt, l_cnt = lRows[0].l_cnt;

  const [upcoming] = await pool.query(
    `SELECT l.public_id, l.end_date, l.status, c.name customer_name, p.name product_name
       FROM licenses l
       JOIN customers c ON c.id = l.customer_id
       JOIN products  p ON p.id = l.product_id
      WHERE l.end_date IS NOT NULL AND l.status IN ('active','ordered')
        AND l.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)
      ORDER BY l.end_date ASC
      LIMIT 12`
  );

  const rows = upcoming.map(r => {
    const days = Math.ceil((new Date(r.end_date).getTime() - Date.now())/86400000);
    const pill = days <= 7 ? 'danger' : days <= 14 ? 'warn' : 'ok';
    return `<tr>
      <td>${esc(r.customer_name)}</td>
      <td>${esc(r.product_name)}</td>
      <td>${esc(r.end_date)}</td>
      <td><span class="pill ${pill}">${days}d</span></td>
      <td><a class="btn" href="/licenses/${esc(r.public_id)}">Öffnen</a></td>
    </tr>`;
  }).join('\n');

  const body = `
  <div class="row">
    <div class="card" style="flex:1">
      <div class="hint">Übersicht</div>
      <h3 style="margin:4px 0 12px">Kennzahlen</h3>
      <div class="row">
        <div class="card" style="min-width:160px"><div class="hint">Kunden</div><div style="font-size:28px">${c_cnt}</div></div>
        <div class="card" style="min-width:160px"><div class="hint">Produkte</div><div style="font-size:28px">${p_cnt}</div></div>
        <div class="card" style="min-width:160px"><div class="hint">Lizenzen</div><div style="font-size:28px">${l_cnt}</div></div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 style="margin:0">Läuft bald ab (60 Tage)</h3>
      <a class="btn" href="/licenses">Alle Lizenzen</a>
    </div>
    <table>
      <thead><tr><th>Kunde</th><th>Produkt</th><th>Ende</th><th>Rest</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="hint">Keine anstehenden Abläufe.</td></tr>'}</tbody>
    </table>
  </div>`;

  res.send(layout('Dashboard', body));
});

// Customers list + create
app.get('/customers', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM customers ORDER BY name');
  const list = rows.map(r => `<tr>
    <td>${esc(r.name)}</td>
    <td>${esc(r.contact_email || '')}</td>
    <td>${esc(r.contact_phone || '')}</td>
    <td>${r.is_active ? '<span class="pill ok">aktiv</span>' : '<span class="pill">inaktiv</span>'}</td>
  </tr>`).join('\n');

  const body = `
  <div class="row">
    <div class="card" style="flex:2">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">Kunden</h3>
      </div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Telefon</th><th>Status</th></tr></thead>
        <tbody>${list}</tbody></table>
    </div>

    <div class="card" style="flex:1;min-width:320px">
      <h3 style="margin-top:0">Neuer Kunde</h3>
      <form method="post" action="/customers">
        <label>Name<input required name="name" /></label>
        <label>Email<input type="email" name="contact_email" /></label>
        <label>Telefon<input name="contact_phone" /></label>
        <label>Adresse<textarea name="address" rows="3"></textarea></label>
        <label>Notizen<textarea name="notes" rows="3"></textarea></label>
        <button class="btn primary" type="submit">Speichern</button>
      </form>
    </div>
  </div>`;

  res.send(layout('Kunden', body));
});

app.post('/customers', async (req, res) => {
  const { name, contact_email, contact_phone, address, notes } = req.body;
  if (!name) return res.status(400).send('name required');
  await pool.query(
    'INSERT INTO customers(name, contact_email, contact_phone, address, notes) VALUES (?,?,?,?,?)',
    [name, contact_email || null, contact_phone || null, address || null, notes || null]
  );
  res.redirect(303, '/customers');
});

// Products list + create
app.get('/products', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY vendor, name');
  const list = rows.map(r => `<tr>
    <td>${esc(r.vendor || '')}</td>
    <td>${esc(r.name)}</td>
    <td>${esc(r.sku || '')}</td>
    <td>${esc(r.default_term_months || '')}</td>
  </tr>`).join('\n');

  const body = `
  <div class="row">
    <div class="card" style="flex:2">
      <h3 style="margin:0 0 8px">Produkte</h3>
      <table><thead><tr><th>Vendor</th><th>Name</th><th>SKU</th><th>Std. Laufzeit (Monate)</th></tr></thead>
        <tbody>${list}</tbody></table>
    </div>

    <div class="card" style="flex:1;min-width:320px">
      <h3 style="margin-top:0">Neues Produkt</h3>
      <form method="post" action="/products">
        <label>Vendor<input name="vendor" /></label>
        <label>Name<input required name="name" /></label>
        <label>SKU<input name="sku" /></label>
        <label>Beschreibung<textarea name="description" rows="3"></textarea></label>
        <label>Std. Laufzeit (Monate)<input type="number" name="default_term_months" min="0" /></label>
        <label>Notizen<textarea name="notes" rows="3"></textarea></label>
        <button class="btn primary" type="submit">Speichern</button>
      </form>
    </div>
  </div>`;

  res.send(layout('Produkte', body));
});

app.post('/products', async (req, res) => {
  const { name, vendor, sku, description, default_term_months, notes } = req.body;
  if (!name) return res.status(400).send('name required');
  await pool.query(
    'INSERT INTO products(name, vendor, sku, description, default_term_months, notes) VALUES (?,?,?,?,?,?)',
    [name, vendor || null, sku || null, description || null, default_term_months || null, notes || null]
  );
  res.redirect(303, '/products');
});

// Licenses list
app.get('/licenses', async (req, res) => {
  const status = req.query.status || '';
  const where = status ? `WHERE l.status = ?` : '';
  const params = status ? [status] : [];
  const [rows] = await pool.query(
    `SELECT l.*, c.name AS customer_name, p.name AS product_name
       FROM licenses l
       JOIN customers c ON c.id = l.customer_id
       JOIN products  p ON p.id = l.product_id
       ${where}
      ORDER BY COALESCE(l.end_date, '2999-12-31') ASC`, params
  );

  const list = rows.map(r => {
    const days = r.end_date ? Math.ceil((new Date(r.end_date).getTime() - Date.now())/86400000) : null;
    const pill = !r.end_date ? '' : (days <= 0 ? 'danger' : days <= 7 ? 'danger' : days <= 14 ? 'warn' : 'ok');
    return `<tr>
      <td>${esc(r.customer_name)}</td>
      <td>${esc(r.product_name)}</td>
      <td>${esc(r.status)}</td>
      <td>${r.end_date ? `${esc(r.end_date)} ${days!==null?`<span class="pill ${pill}">${days}d</span>`:''}` : ''}</td>
      <td><a class="btn" href="/licenses/${esc(r.public_id)}">Öffnen</a></td>
    </tr>`;
  }).join('\n');

  const body = `
  <div class="row" style="justify-content:space-between;align-items:center">
    <h3 style="margin:0">Lizenzen</h3>
    <a class="btn primary" href="/licenses/new">Neue Lizenz</a>
  </div>
  <div class="card" style="margin-top:8px">
    <form method="get" action="/licenses" style="margin-bottom:8px">
      <label>Status
        <select name="status" onchange="this.form.submit()">
          <option value="">Alle</option>
          ${['ordered','active','expired','cancelled'].map(s=>`<option ${status===s?'selected':''} value="${s}">${s}</option>`).join('')}
        </select>
      </label>
    </form>
    <table>
      <thead><tr><th>Kunde</th><th>Produkt</th><th>Status</th><th>Ende</th><th></th></tr></thead>
      <tbody>${list || '<tr><td colspan="5" class="hint">Keine Lizenzen vorhanden.</td></tr>'}</tbody>
    </table>
  </div>`;

  res.send(layout('Lizenzen', body));
});

// New license form
app.get('/licenses/new', async (_req, res) => {
  const [customers] = await pool.query('SELECT id, name FROM customers WHERE is_active=1 ORDER BY name');
  const [products]  = await pool.query('SELECT id, name FROM products ORDER BY name');
  const selCust = customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const selProd = products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  const body = `
  <div class="card">
    <h3 style="margin-top:0">Neue Lizenz</h3>
    <form method="post" action="/licenses">
      <div class="grid">
        <div>
          <label>Kunde<select name="customer_id" required>${selCust}</select></label>
        </div>
        <div>
          <label>Produkt<select name="product_id" required>${selProd}</select></label>
        </div>
        <div>
          <label>Status
            <select name="status">
              <option>ordered</option>
              <option selected>active</option>
              <option>expired</option>
              <option>cancelled</option>
            </select>
          </label>
        </div>
        <div>
          <label>Term-Typ
            <select name="term_type">
              <option selected>subscription</option>
              <option>perpetual</option>
              <option>maintenance</option>
            </select>
          </label>
        </div>
        <div>
          <label>Start<input type="date" name="start_date" /></label>
        </div>
        <div>
          <label>Ende<input type="date" name="end_date" /></label>
        </div>
        <div>
          <label>Sitze<input type="number" name="seats" min="0" /></label>
        </div>
        <div>
          <label>Auto-Renew
            <select name="auto_renew"><option value="0">Nein</option><option value="1">Ja</option></select>
          </label>
        </div>
        <div class="grid" style="grid-template-columns:1fr">
          <label>Lizenz-Key<input name="license_key" /></label>
        </div>
        <div class="grid" style="grid-template-columns:1fr">
          <label>PO-Nummer<input name="po_number" /></label>
        </div>
        <div class="grid" style="grid-template-columns:1fr">
          <label>Renewal-Notizen<textarea name="renewal_notes" rows="3"></textarea></label>
        </div>
        <div class="grid" style="grid-template-columns:1fr">
          <label>Notizen<textarea name="notes" rows="3"></textarea></label>
        </div>
      </div>
      <div style="margin-top:12px"><button class="btn primary" type="submit">Anlegen</button>
        <a class="btn" href="/licenses">Abbrechen</a></div>
    </form>
  </div>`;

  res.send(layout('Neue Lizenz', body));
});

// Create license (UI form)
app.post('/licenses', async (req, res) => {
  const b = req.body;
  if (!b.customer_id || !b.product_id) return res.status(400).send('customer_id & product_id required');
  const pid = ulid();
  await pool.query(
    `INSERT INTO licenses(public_id, customer_id, product_id, status, term_type, license_key, seats, start_date, end_date, auto_renew, renewal_notes, po_number, responsible_user_id, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [pid, b.customer_id, b.product_id, b.status || 'ordered', b.term_type || 'subscription', b.license_key || null, b.seats || null, b.start_date || null, b.end_date || null, b.auto_renew ? 1 : 0, b.renewal_notes || null, b.po_number || null, null, b.notes || null]
  );
  res.redirect(303, `/licenses/${pid}`);
});

// License detail + edit (UI)
app.get('/licenses/:public_id', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, c.name AS customer_name, c.id AS customer_id, p.name AS product_name, p.id AS product_id
       FROM licenses l
       JOIN customers c ON c.id=l.customer_id
       JOIN products  p ON p.id=l.product_id
      WHERE l.public_id=?`, [req.params.public_id]
  );
  const l = rows[0];
  if (!l) return res.status(404).send('not found');

  const [customers] = await pool.query('SELECT id, name FROM customers WHERE is_active=1 ORDER BY name');
  const [products]  = await pool.query('SELECT id, name FROM products ORDER BY name');
  const selCust = customers.map(c => `<option value="${c.id}" ${c.id===l.customer_id?'selected':''}>${esc(c.name)}</option>`).join('');
  const selProd = products.map(p => `<option value="${p.id}" ${p.id===l.product_id?'selected':''}>${esc(p.name)}</option>`).join('');

  const body = `
  <div class="row" style="justify-content:space-between;align-items:center">
    <h3 style="margin:0">${esc(l.customer_name)} — ${esc(l.product_name)}</h3>
    <a class="btn" href="/licenses">Zurück</a>
  </div>
  <div class="card" style="margin-top:8px">
    <form method="post" action="/licenses/${esc(l.public_id)}">
      <div class="grid">
        <div><label>Kunde<select name="customer_id" required>${selCust}</select></label></div>
        <div><label>Produkt<select name="product_id" required>${selProd}</select></label></div>
        <div><label>Status
          <select name="status">
            ${['ordered','active','expired','cancelled'].map(s=>`<option ${l.status===s?'selected':''}>${s}</option>`).join('')}
          </select></label>
        </div>
        <div><label>Term-Typ
          <select name="term_type">
            ${['subscription','perpetual','maintenance'].map(s=>`<option ${l.term_type===s?'selected':''}>${s}</option>`).join('')}
          </select></label>
        </div>
        <div><label>Start<input type="date" name="start_date" value="${l.start_date?esc(dayjs(l.start_date).format('YYYY-MM-DD')):''}" /></label></div>
        <div><label>Ende<input type="date" name="end_date" value="${l.end_date?esc(dayjs(l.end_date).format('YYYY-MM-DD')):''}" /></label></div>
        <div><label>Sitze<input type="number" name="seats" value="${l.seats??''}" /></label></div>
        <div><label>Auto-Renew<select name="auto_renew"><option value="0" ${!l.auto_renew?'selected':''}>Nein</option><option value="1" ${l.auto_renew?'selected':''}>Ja</option></select></label></div>
        <div class="grid" style="grid-template-columns:1fr"><label>Lizenz-Key<input name="license_key" value="${esc(l.license_key||'')}" /></label></div>
        <div class="grid" style="grid-template-columns:1fr"><label>PO-Nummer<input name="po_number" value="${esc(l.po_number||'')}" /></label></div>
        <div class="grid" style="grid-template-columns:1fr"><label>Renewal-Notizen<textarea name="renewal_notes" rows="3">${esc(l.renewal_notes||'')}</textarea></label></div>
        <div class="grid" style="grid-template-columns:1fr"><label>Notizen<textarea name="notes" rows="3">${esc(l.notes||'')}</textarea></label></div>
      </div>
      <div style="margin-top:12px">
        <button class="btn primary" type="submit">Speichern</button>
      </div>
    </form>
  </div>`;

  res.send(layout('Lizenz', body));
});

// Update license (UI form post)
app.post('/licenses/:public_id', async (req, res) => {
  const pid = req.params.public_id;
  const b = req.body;
  const fields = ['customer_id','product_id','status','term_type','license_key','seats','start_date','end_date','auto_renew','renewal_notes','po_number','notes'];
  const sets = fields.map(f => `${f} = ?`).join(',');
  const values = [b.customer_id, b.product_id, b.status, b.term_type, b.license_key || null, b.seats || null, b.start_date || null, b.end_date || null, b.auto_renew ? 1 : 0, b.renewal_notes || null, b.po_number || null, b.notes || null, pid];
  await pool.query(`UPDATE licenses SET ${sets} WHERE public_id = ?`, values);
  res.redirect(303, `/licenses/${pid}`);
});

/* ========================= Start & Jobs ====================== */
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Licenses UI+API running on :${port}`);
});
scheduleReminders();