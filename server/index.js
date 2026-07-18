// ===== 加载 .env（零依赖，避免把密钥写进源码）=====
// 必须在 require 任何路由/中间件之前执行，因为它们在模块加载时就读取 process.env。
(function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const express = require('express');
const path = require('path');

const { generateDueNotifications } = require('./util/notifications');

const app = express();
app.use(express.json());

// 触发建库 + 种子（require 即执行 schema.sql 与 seed.js）
require('./db');

const root = path.join(__dirname, '..'); // 项目根，托管前端静态资源
app.use(express.static(root));

// 默认打开新前端 app.html（避免旧 index.html 干扰）
app.get('/', (req, res) => res.redirect('/app.html'));

// API 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard')); // GET /api/dashboard -> 首页概览
app.use('/api/medications', require('./routes/medications'));
app.use('/api/tips', require('./routes/tips'));
app.use('/api/pharmacist', require('./routes/pharmacist'));
app.use('/api/science', require('./routes/science'));
app.use('/api/forum', require('./routes/forum'));
app.use('/api/records', require('./routes/records'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/dify', require('./routes/dify')); // 吸入指导聊天 · Dify 流式代理（Key 在服务端）

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('COPD 慢病管理平台后端已启动: http://localhost:' + PORT);
  console.log('前端入口: http://localhost:' + PORT + '/app.html');
});

// 自动通知调度：启动后稍候扫描一次，并每 24 小时扫描一次（与首页打开时的实时扫描互为备份）
const db = require('./db');
setTimeout(() => generateDueNotifications(db), 1500);
setInterval(() => generateDueNotifications(db), 24 * 60 * 60 * 1000);
