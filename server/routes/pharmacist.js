const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// 药师排班
router.get('/schedule', (req, res) => {
  const rows = db.prepare(
    'SELECT id, day_of_week AS dayOfWeek, session, location, note FROM pharmacist_schedule ORDER BY id'
  ).all();
  res.json({ schedule: rows });
});

// 预约咨询
router.post('/consultations', authMiddleware, (req, res) => {
  const { scheduled_at: scheduledAt, note } = req.body || {};
  if (!scheduledAt) return res.status(400).json({ error: '请选择预约时间' });
  const info = db.prepare(
    'INSERT INTO consultations (user_id, scheduled_at, note, status) VALUES (?,?,?,?)'
  ).run(req.user.uid, scheduledAt, note || null, 'pending');
  res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
});

module.exports = router;
