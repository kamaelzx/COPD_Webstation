const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// JWT 签名密钥：优先取环境变量 JWT_SECRET（存于 .env，已 gitignore）。
// 若缺失，则每次启动生成临时密钥——避免把任何固定密钥写进源码；
// 代价是服务重启后已签发的 token 失效（用户需重新登录）。
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const tmp = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] 警告：未设置 JWT_SECRET，已使用本次启动的临时密钥，重启后登录态将失效。请在 .env 配置固定强随机值。');
  return tmp;
}
const SECRET = loadJwtSecret();

function sign(user) {
  return jwt.sign({ uid: user.id, phone: user.phone }, SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: '未登录：缺少 token' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
}

module.exports = { sign, authMiddleware, SECRET };
