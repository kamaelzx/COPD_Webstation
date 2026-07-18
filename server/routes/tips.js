const express = require('express');
const router = express.Router();
const db = require('../db');

// 健康小贴士
// - 默认：按日期轮询，每天稳定一条
// - ?all=1：返回全部已发布贴士（用于前端顺序轮循）
router.get('/', (req, res) => {
  const tips = db.prepare(
    "SELECT id, category, title, content FROM health_tips WHERE published=1 ORDER BY id ASC"
  ).all();
  if (!tips.length) return res.json({ id: null, category: '', title: '', content: '' });
  if (req.query.all === '1') return res.json({ tips });
  const idx = new Date().getDate() % tips.length;
  const t = tips[idx];
  res.json({ id: t.id, category: t.category, title: t.title, content: t.content });
});

module.exports = router;
