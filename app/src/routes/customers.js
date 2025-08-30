

import { Router } from 'express';
import { pool } from '../db.js';

export const customers = Router();

customers.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM customers WHERE is_active = 1 ORDER BY name');
  res.json(rows);
});

customers.post('/', async (req, res) => {
  const { name, contact_email, contact_phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const [r] = await pool.query(
    'INSERT INTO customers(name, contact_email, contact_phone, address, notes) VALUES (?,?,?,?,?)',
    [name, contact_email || null, contact_phone || null, address || null, notes || null]
  );
  const [row] = await pool.query('SELECT * FROM customers WHERE id=?', [r.insertId]);
  res.status(201).json(row[0]);
});

customers.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

customers.put('/:id', async (req, res) => {
  const { name, contact_email, contact_phone, address, notes, is_active } = req.body;
  await pool.query(
    `UPDATE customers SET name=COALESCE(?,name), contact_email=?, contact_phone=?, address=?, notes=?, is_active=COALESCE(?, is_active) WHERE id=?`,
    [name, contact_email || null, contact_phone || null, address || null, notes || null, is_active, req.params.id]
  );
  const [rows] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
  res.json(rows[0]);
});

