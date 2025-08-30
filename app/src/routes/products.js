
import { Router } from 'express';
import { pool } from '../db.js';

export const products = Router();

products.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY vendor, name');
  res.json(rows);
});

products.post('/', async (req, res) => {
  const { name, vendor, sku, description, default_term_months, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const [r] = await pool.query(
    'INSERT INTO products(name, vendor, sku, description, default_term_months, notes) VALUES (?,?,?,?,?,?)',
    [name, vendor || null, sku || null, description || null, default_term_months || null, notes || null]
  );
  const [row] = await pool.query('SELECT * FROM products WHERE id=?', [r.insertId]);
  res.status(201).json(row[0]);
});