import { Router } from 'express';
import { pool } from '../db.js';

export const calendar = Router();

calendar.get('/:token', async (req, res) => {
  if (req.params.token !== process.env.ICS_TOKEN) return res.status(403).end();
  const [rows] = await pool.query(
    `SELECT l.public_id, l.end_date, c.name AS customer_name, p.name AS product_name
       FROM licenses l
       JOIN customers c ON c.id = l.customer_id
       JOIN products  p ON p.id = l.product_id
      WHERE l.end_date IS NOT NULL AND l.status IN ('active','ordered')`
  );
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Licenses//MVP//EN'
  ];
  for (const r of rows) {
    const dt = String(r.end_date).replaceAll('-','') + 'T090000Z';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.public_id}@licenses`,
      `DTSTAMP:${dt}`,
      `DTSTART:${dt}`,
      `SUMMARY:${r.customer_name} – ${r.product_name} läuft ab`,
      `DESCRIPTION:${process.env.BASE_URL}/licenses/${r.public_id}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type','text/calendar; charset=utf-8');
  res.send(lines.join('\r\n'));
});
