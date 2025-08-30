import cron from 'node-cron';
import dayjs from 'dayjs';
import { pool } from '../db.js';
import { sendEmail } from '../email.js';
import { request } from 'undici';

const LEVELS = [
  { label: '30d', days: 30 },
  { label: '14d', days: 14 },
  { label: '7d',  days: 7  },
  { label: '1d',  days: 1  },
  { label: 'expired', days: 0 }
];

async function licensesExpiringOn(dateStr) {
  const [rows] = await pool.query(
    `SELECT l.id, l.public_id, l.end_date, l.status, l.license_key, l.seats,
            c.name AS customer_name, c.contact_email,
            p.name AS product_name
       FROM licenses l
       JOIN customers c ON c.id = l.customer_id
       JOIN products  p ON p.id = l.product_id
      WHERE l.status IN ('active','ordered')
        AND l.end_date IS NOT NULL
        AND l.end_date = ?
      ORDER BY l.end_date ASC`,
    [dateStr]
  );
  return rows;
}

async function markSent(licenseId, level, channel, details = null) {
  try {
    await pool.query(
      `INSERT IGNORE INTO reminders_log(license_id, level, channel, details)
       VALUES (?,?,?,?)`, [licenseId, level, channel, details]
    );
  } catch {}
}

function htmlTable(list) {
  const rows = list.map(l => `
    <tr>
      <td>${l.customer_name}</td>
      <td>${l.product_name}</td>
      <td>${l.end_date}</td>
      <td>${l.seats ?? ''}</td>
      <td>${l.license_key ?? ''}</td>
      <td><a href="${process.env.BASE_URL}/licenses/${l.public_id}">Details</a></td>
    </tr>`).join('\n');
  return `
  <table border="1" cellpadding="6" cellspacing="0">
    <thead><tr>
      <th>Kunde</th><th>Produkt</th><th>Enddatum</th><th>Sitze</th><th>Key</th><th>Link</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function notify(level, list) {
  if (!list.length) return;
  const title = level === 'expired' ? 'Abgelaufene Lizenzen' : `Lizenzen laufen in ${LEVELS.find(l=>l.label===level)?.days} Tagen ab`;
  const html = `<p>${title}</p>${htmlTable(list)}`;
  await sendEmail({ subject: `[Licenses] ${title}`, html });
  await Promise.all(list.map(l => markSent(l.id, level, 'email')));

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    try {
      const text = `${title}:\n` + list.map(l => `• ${l.customer_name} – ${l.product_name} (bis ${l.end_date})`).join('\n');
      await request(webhook, { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } });
      await Promise.all(list.map(l => markSent(l.id, level, 'slack')));
    } catch {}
  }
}

export function scheduleReminders() {
  // Täglich um 08:00 Uhr Europe/Zurich
  cron.schedule('0 8 * * *', async () => {
    const today = dayjs();
    for (const { label, days } of LEVELS) {
      const dateStr = today.add(days * (label==='expired' ? -1 : 1) - (label==='expired'?0:0), 'day').format('YYYY-MM-DD');
      const list = label === 'expired'
        ? await licensesExpiringOn(today.add(-1, 'day').format('YYYY-MM-DD')) // alle die gestern endeten => heute als "abgelaufen" melden
        : await licensesExpiringOn(dateStr);

      // Doppelversand verhindern
      const [sentRows] = await pool.query(
        `SELECT license_id FROM reminders_log WHERE level = ?`, [label]
      );
      const sent = new Set(sentRows.map(r => r.license_id));
      const toSend = list.filter(l => !sent.has(l.id));
      await notify(label, toSend);
    }
  }, { timezone: 'Europe/Zurich' });
}