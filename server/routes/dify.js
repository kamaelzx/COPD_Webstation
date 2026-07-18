const express = require('express');
const router = express.Router();
const { Readable } = require('stream');
const { authMiddleware } = require('../middleware/auth');

// ===== 吸入指导聊天 · Dify 流式代理 =====
// 设计要点：
//   1) Key 只在服务端持有（环境变量或本文件常量），前端完全不接触，彻底不暴露。
//   2) 前端调同源 /api/dify/chat，浏览器到 Dify 的跨域（CORS）请求被服务端代发绕开。
//   3) 直接把 Dify 的 SSE 流式响应 pipe 回前端，打字机效果无缝衔接。
// 配置（优先级：环境变量 > 本文件占位）：
//   环境变量（推荐，存于项目根 .env，已 gitignore）：
//     DIFY_API_KEY=app-xxxx   DIFY_API_URL=https://dr.ustb.ac.cn/v1/chat-messages
//   未配置时 DIFY_KEY 退回占位 'app-xxxx'，路由会主动报错、绝不带真实密钥启动。
const DIFY_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_KEY = process.env.DIFY_API_KEY || 'app-xxxx'; // 占位：真实 Key 请放 .env 的 DIFY_API_KEY，源码不再硬编码

router.post('/chat', authMiddleware, async (req, res) => {
  if (!DIFY_KEY || DIFY_KEY.startsWith('app-xxxx')) {
    return res.status(400).json({ error: 'Dify API Key 未配置：设置环境变量 DIFY_API_KEY，或在 server/routes/dify.js 填写 DIFY_KEY。' });
  }

  let upstream;
  try {
    upstream = await fetch(DIFY_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + DIFY_KEY,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        inputs: req.body.inputs || {},
        query: req.body.query || '',
        user: String(req.user.uid),   // 用登录用户 uid 作为 Dify user，多轮会话可跨会话延续
        response_mode: 'streaming',
        conversation_id: req.body.conversation_id || '',
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: '调用 Dify 失败：' + e.message });
  }

  if (!upstream.ok) {
    const txt = await upstream.text().catch(() => '');
    return res.status(upstream.status).json({ error: txt.slice(0, 400) });
  }

  // 原样转发 SSE 流
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 关闭 nginx 等反代缓冲，保证流式实时

  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.pipe(res);
  req.on('close', () => { try { nodeStream.destroy(); } catch (_) {} });
});

module.exports = router;
