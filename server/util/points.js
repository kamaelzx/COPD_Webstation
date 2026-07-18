// 健康积分工具
// 设计要点：积分 = points_log 中 delta 的累加。
// 「每日任务型」奖励（每日登录 / 完成当日全部用药）按「用户 + 类型 + 日期」幂等发放，
// 同一天同一类型只计一次，避免重复刷新/重复打卡导致刷分。
const { beijingDate: todayStr } = require('./time');

// 累计总积分
function totalPoints(db, uid) {
  const r = db.prepare('SELECT COALESCE(SUM(delta),0) AS p FROM points_log WHERE user_id=?').get(uid);
  return r.p;
}

// 今日已获得积分（reason 形如「每日登录 (2026-07-14)」，按日期模糊匹配）
function todayPoints(db, uid, dateStr = todayStr()) {
  const r = db.prepare(
    'SELECT COALESCE(SUM(delta),0) AS p FROM points_log WHERE user_id=? AND reason LIKE ?'
  ).get(uid, `%(${dateStr})%`);
  return r.p;
}

// 每日任务型奖励：同用户同类型同日期只发一次
// label 例如「每日登录」「每日用药打卡」，会自动拼接日期形成唯一 reason 作为去重键
function awardDaily(db, uid, label, delta, dateStr = todayStr()) {
  const reason = `${label} (${dateStr})`;
  const exist = db.prepare('SELECT 1 FROM points_log WHERE user_id=? AND reason=?').get(uid, reason);
  if (exist) return { awarded: false, points: totalPoints(db, uid) };
  db.prepare('INSERT INTO points_log (user_id, delta, reason) VALUES (?,?,?)').run(uid, delta, reason);
  return { awarded: true, points: totalPoints(db, uid) };
}

module.exports = { todayStr, totalPoints, todayPoints, awardDaily };
