const express = require('express');
const router = express.Router();
const db = require('../db');

// 药学科普讲堂
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT id, title, category, summary, type, cover, url FROM science_articles ORDER BY id DESC'
  ).all();
  res.json({ articles: rows });
});

module.exports = router;
