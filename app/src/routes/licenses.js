import { Router } from 'express';
import { pool } from '../db.js';
import { ulid } from 'ulid';

export const licenses = Router();

licenses.get('/', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, c.name as customer_name, p.name as product_name
       FROM licenses l
       JOIN customers c ON c.id = l.customer_id
       JOIN products  p ON p.id = l.product_id
      ORDER BY COALESCE(l.end_date, '2999-12-31') ASC`);
  res.json(rows);
});

licenses.post('/', async (req, res) => {
  const { customer_id, product_id, status, term_type, license_key, seats, start_date, end_date, auto_renew, renewal_notes, po_number, responsible_user_id, notes } = req.body;
  if (!customer_id || !product_id) return res.status(400).json({ error: 'customer_id & product_id required' });
  const pid = ulid();
  const [r] = await pool.query(
    `INSERT INTO licenses(public_id, customer_id, product_id, status, term_type, license_key, seats, start_date, end_date, auto_renew, renewal_notes, po_number, responsible_user_id, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [pid, customer_id, product_id, status || 'ordered', term_type || 'subscription', license_key || null, seats || null, start_date || null, end_date || null, auto_renew ? 1 : 0, renewal_notes || null, po_number || null, responsible_user_id || null, notes || null]
  );
  const [row] = await pool.query('SELECT * FROM licenses WHERE id=?', [r.insertId]);
  res.status(201).json(row[0]);
});

licenses.get('/:public_id', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, c.name AS customer_name, c.contact_email, p.name AS product_name
       FROM licenses l
       JOIN customers c ON c.id = l.customer_id
       JOIN products  p ON p.id = l.product_id
      WHERE l.public_id = ?`, [req.params.public_id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

licenses.put('/:public_id', async (req, res) => {
  const fields = ['status','term_type','license_key','seats','start_date','end_date','auto_renew','renewal_notes','po_number','responsible_user_id','notes'];
  const sets = fields.map(f => `${f} = COALESCE(?, ${f})`).join(', ');
  const values = fields.map(f => f === 'auto_renew' ? (req.body[f] === undefined ? undefined : (req.body[f] ? 1 : 0)) : req.body[f]);
  values.push(req.params.public_id);
  await pool.query(`UPDATE licenses SET ${sets} WHERE public_id = ?`, values);
  const [rows] = await pool.query('SELECT * FROM licenses WHERE public_id=?', [req.params.public_id]);
  res.json(rows[0]);
});
