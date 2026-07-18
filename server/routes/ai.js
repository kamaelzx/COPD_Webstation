const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// AI 用药助手：未配置 Dify 时返回演示回答；配置后代理转发
router.post('/chat', authMiddleware, async (req, res) => {
  const message = (req.body && req.body.message) || '';
  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';

  if (!apiKey) {
    return res.json({
      reply: `（演示模式）已收到您的提问：「${message}」。接入 Dify 后，这里会返回真实的用药咨询回答。`
    });
  }
  try {
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: {}, query: message, user: String(req.user.uid), response_mode: 'blocking' })
    });
    const d = await r.json();
    res.json({ reply: d.answer || d.message || JSON.stringify(d) });
  } catch (e) {
    res.status(502).json({ error: '调用 AI 服务失败', detail: String(e) });
  }
});

module.exports = router;
