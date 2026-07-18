const express = require('express');
const router = express.Router();
const db = require('../db');
const { sign, authMiddleware } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../util/crypto');
const { awardDaily } = require('../util/points');

function publicUser(u) {
  return {
    id: u.id, name: u.name, avatarInitial: u.avatar_initial, gender: u.gender,
    birthday: u.birthday, diagnosis: u.diagnosis, stage: u.stage, phone: u.phone,
    lang: u.lang, manageDays: u.manage_days, nextVisitDate: u.next_visit_date
  };
}

// 登录：手机号 + 密码
router.post('/login', (req, res) => {
  const phone = (req.body && req.body.phone) || '';
  const password = (req.body && req.body.password) || '';
  if (!phone) return res.status(400).json({ error: '请提供手机号' });
  if (!password) return res.status(400).json({ error: '请输入密码' });
  const u = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u) return res.status(404).json({ error: '未找到该手机号对应的患者，请先注册' });
  if (!verifyPassword(password, u.password_hash)) {
    return res.status(401).json({ error: '手机号或密码不正确' });
  }
  const pa = awardDaily(db, u.id, '每日登录', 1);
  res.json({ token: sign(u), user: publicUser(u), pointsAwarded: pa.awarded, points: pa.points });
});

// 注册：手机号 + 姓名 + 密码，自动建档并返回 token
router.post('/register', (req, res) => {
  const phone = (req.body && req.body.phone) || '';
  const name = (req.body && req.body.name) || '';
  const password = (req.body && req.body.password) || '';
  if (!phone) return res.status(400).json({ error: '请提供手机号' });
  if (!/^\d{6,11}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!name) return res.status(400).json({ error: '请填写姓名' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const exist = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
  if (exist) return res.status(409).json({ error: '该手机号已注册，请直接登录' });
  const info = db.prepare('INSERT INTO users (name, phone, password_hash, avatar_initial, lang, manage_days) VALUES (?, ?, ?, ?, ?, 0)');
  const result = info.run(name, phone, hashPassword(password), name.trim().charAt(0), 'zh');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
  const pa = awardDaily(db, u.id, '每日登录', 1);
  res.json({ token: sign(u), user: publicUser(u), pointsAwarded: pa.awarded, points: pa.points });
});

// 登出（JWT 无状态，前端清理 token 即可，此接口用于语义完整）
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.uid);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: publicUser(u) });
});

// 更新个人资料（姓名 / 性别 / 出生日期 / 诊断 / 下次随访时间）
router.put('/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.uid);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const body = req.body || {};
  const txtMap = { name: 'name', gender: 'gender', birthday: 'birthday', diagnosis: 'diagnosis' };
  const sets = [];
  const vals = [];
  ['name', 'gender', 'birthday', 'diagnosis'].forEach(f => {
    const v = body[f];
    if (v === undefined || v === null) return;
    if (f === 'name' && !String(v).trim()) return; // 姓名不可为空
    sets.push(txtMap[f] + '=?');
    vals.push(String(v).trim());
  });
  // 下次随访时间：允许清空（设为 NULL）
  if (body.nextVisitDate !== undefined) {
    const v = (body.nextVisitDate || '').trim();
    sets.push('next_visit_date=?');
    vals.push(v || null);
  }
  if (sets.length) {
    db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id=?').run(...vals, u.id);
  }
  const nu = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  res.json({ user: publicUser(nu) });
});

// 修改密码：需校验当前密码，新密码至少 6 位
router.put('/password', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.uid);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const cur = (req.body && req.body.currentPassword) || '';
  const next = (req.body && req.body.newPassword) || '';
  if (!verifyPassword(cur, u.password_hash)) return res.status(400).json({ error: '当前密码不正确' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(next), u.id);
  res.json({ ok: true });
});

module.exports = router;
