const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { todayPoints } = require('../util/points');
const { generateDueNotifications } = require('../util/notifications');

// 首页健康驾驶舱概览：指标实时计算
router.get('/', authMiddleware, (req, res) => {
  // 每次打开首页时扫描并生成到期通知（漏打卡 / 复诊前 3 天），幂等不重复
  generateDueNotifications(db);
  const uid = req.user.uid;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM medication_logs l
         JOIN medications m ON m.id=l.medication_id
         WHERE l.user_id=? AND l.taken=1 AND l.log_date>=date('now','+8 hours','-6 days')) AS taken,
      (SELECT COUNT(*) FROM medications WHERE user_id=? AND active=1) * 7 AS scheduled,
      (SELECT COALESCE(SUM(delta),0) FROM points_log WHERE user_id=?) AS points,
      CAST(julianday(next_visit_date) - julianday('now','+8 hours') AS INTEGER) AS followup
    FROM users WHERE id=?
  `).get(uid, uid, uid, uid);

  const adherence = stats.scheduled > 0 ? Math.round(stats.taken / stats.scheduled * 100) : 0;
  const followup = (stats.followup === null || stats.followup < 0) ? null : stats.followup;

  res.json({
    name: u.name,
    avatarInitial: u.avatar_initial,
    manageDays: u.manage_days,
    adherence,
    nextFollowUpDays: followup,
    points: stats.points,
    todayPoints: todayPoints(db, uid)
  });
});

module.exports = router;
