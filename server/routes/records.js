const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const rows = db.prepare(
    'SELECT id, type, title, record_date AS recordDate, detail FROM health_records WHERE user_id=? ORDER BY record_date DESC'
  ).all(req.user.uid);
  res.json({ records: rows });
});

router.post('/', authMiddleware, (req, res) => {
  const { type, title, record_date: recordDate, detail } = req.body || {};
  if (!title) return res.status(400).json({ error: '标题必填' });
  const info = db.prepare(
    'INSERT INTO health_records (user_id, type, title, record_date, detail) VALUES (?,?,?,?,?)'
  ).run(req.user.uid, type || null, title, recordDate || null, detail || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
