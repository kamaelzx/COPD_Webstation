const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const rows = db.prepare(
    'SELECT id, type, title, body, is_read AS isRead, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC'
  ).all(req.user.uid);
  res.json({ notifications: rows });
});

router.post('/:id/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?')
    .run(Number(req.params.id), req.user.uid);
  res.json({ ok: true });
});

module.exports = router;
