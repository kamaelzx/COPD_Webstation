const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/posts', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.title, p.body, p.likes, p.created_at, u.name AS author
    FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id
    ORDER BY p.created_at DESC
  `).all();
  res.json({ posts: rows });
});

router.post('/posts', authMiddleware, (req, res) => {
  const { title, body } = req.body || {};
  if (!title && !body) return res.status(400).json({ error: '内容不能为空' });
  const info = db.prepare('INSERT INTO forum_posts (user_id, title, body) VALUES (?,?,?)')
    .run(req.user.uid, title || '', body || '');
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/posts/:id/comments', (req, res) => {
  const rows = db.prepare(
    'SELECT id, body, created_at, user_id FROM forum_comments WHERE post_id=? ORDER BY id'
  ).all(Number(req.params.id));
  res.json({ comments: rows });
});

router.post('/posts/:id/comments', authMiddleware, (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: '评论内容不能为空' });
  const info = db.prepare('INSERT INTO forum_comments (post_id, user_id, body) VALUES (?,?,?)')
    .run(Number(req.params.id), req.user.uid, body);
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
