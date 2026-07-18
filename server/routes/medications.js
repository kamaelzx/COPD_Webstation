const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { awardDaily, totalPoints } = require('../util/points');
const { beijingDate: todayStr, beijingTime } = require('../util/time');

// 全部用药方案
router.get('/', authMiddleware, (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, dose, frequency, time_slot AS timeSlot, active FROM medications WHERE user_id=? ORDER BY time_slot'
  ).all(req.user.uid);
  res.json({ medications: rows });
});

// 新增用药方案（用药设置录入）
router.post('/', authMiddleware, (req, res) => {
  const { name, dose, time_slot: timeSlot, frequency } = req.body || {};
  if (!name) return res.status(400).json({ error: '药品名称必填' });
  if (!timeSlot) return res.status(400).json({ error: '用药时间必填' });
  const info = db.prepare(
    'INSERT INTO medications (user_id, name, dose, frequency, time_slot, start_date, active) VALUES (?,?,?,?,?,?,1)'
  ).run(req.user.uid, name, dose || null, frequency || null, timeSlot, todayStr());
  const m = db.prepare(
    'SELECT id, name, dose, frequency, time_slot AS timeSlot, active FROM medications WHERE id=?'
  ).get(info.lastInsertRowid);
  res.status(201).json({ medication: m });
});

// 今日用药 + 完成态
router.get('/today', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const t = todayStr();
  const rows = db.prepare(`
    SELECT m.id, m.name, m.dose, m.time_slot, COALESCE(l.taken,0) AS taken
    FROM medications m
    LEFT JOIN medication_logs l ON l.medication_id=m.id AND l.log_date=?
    WHERE m.user_id=? AND m.active=1
    ORDER BY m.time_slot
  `).all(t, uid);
  const meds = rows.map(r => ({
    id: r.id, name: r.name, dose: r.dose, time_slot: r.time_slot, taken: !!r.taken
  }));
  res.json({ date: t, meds });
});

// 打卡切换（默认标记已服；body.taken=false 可取消）
router.post('/:id/take', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const taken = (req.body && req.body.taken) !== false;
  const uid = req.user.uid;
  const m = db.prepare('SELECT id, time_slot FROM medications WHERE id=? AND user_id=?').get(id, uid);
  if (!m) return res.status(404).json({ error: '用药方案不存在' });
  const t = todayStr();
  const now = t + ' ' + beijingTime();
  db.prepare(`
    INSERT INTO medication_logs (medication_id, user_id, log_date, scheduled_time, taken, taken_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(medication_id, log_date) DO UPDATE SET taken=excluded.taken, taken_at=excluded.taken_at
  `).run(id, uid, t, m.time_slot, taken ? 1 : 0, taken ? now : null);

  // 完成「当日全部用药」任务 -> 每日用药打卡 +1（幂等：同一天仅一次）
  let dailyMedsComplete = false, pointsAwarded = false, points = null;
  if (taken) {
    const active = db.prepare('SELECT COUNT(*) AS c FROM medications WHERE user_id=? AND active=1').get(uid).c;
    const done = db.prepare(`
      SELECT COUNT(DISTINCT l.medication_id) AS c
      FROM medication_logs l JOIN medications mm ON mm.id=l.medication_id
      WHERE l.user_id=? AND l.log_date=? AND l.taken=1 AND mm.active=1
    `).get(uid, t).c;
    dailyMedsComplete = active > 0 && active === done;
    if (dailyMedsComplete) {
      const pa = awardDaily(db, uid, '每日用药打卡', 1, t);
      pointsAwarded = pa.awarded;
      points = pa.points;
    }
  }
  if (points === null) points = totalPoints(db, uid);
  res.json({ id, taken, dailyMedsComplete, pointsAwarded, points });
});

// 删除用药方案（同时清掉其打卡记录）
router.delete('/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const uid = req.user.uid;
  const m = db.prepare('SELECT id FROM medications WHERE id=? AND user_id=?').get(id, uid);
  if (!m) return res.status(404).json({ error: '用药方案不存在' });
  db.prepare('DELETE FROM medication_logs WHERE medication_id=? AND user_id=?').run(id, uid);
  db.prepare('DELETE FROM medications WHERE id=? AND user_id=?').run(id, uid);
  res.json({ ok: true });
});

// 重置用药依从性：清除该用户全部打卡记录，依从率将重算为 0（不可恢复）
router.post('/reset-adherence', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  db.prepare('DELETE FROM medication_logs WHERE user_id=?').run(uid);
  res.json({ ok: true });
});

module.exports = router;
