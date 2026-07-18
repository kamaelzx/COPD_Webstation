// 通知工具：创建通知（按 dedup_key 幂等）+ 按规则自动生成到期通知
// 依赖：node:sqlite 的 DatabaseSync 实例（db）

// 用药时间 time_slot 以北京时间（GMT+8）为准，故「今天日期」「当前时间」统一用北京时间
const { beijingDate: todayStr, beijingTime: nowHHMM } = require('./time');

/**
 * 创建一条通知。若传入 dedupKey，则同一用户 + 同一 key 已存在时跳过（保证每天/每个事件只生成一次）。
 * @returns {{id:number, created:boolean}}
 */
function createNotification(db, { userId, type, title, body, dedupKey }) {
  if (dedupKey) {
    const ex = db.prepare('SELECT id FROM notifications WHERE user_id=? AND dedup_key=?').get(userId, dedupKey);
    if (ex) return { id: ex.id, created: false };
  }
  const info = db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, is_read, dedup_key) VALUES (?,?,?,?,0,?)'
  ).run(userId, type, title, body, dedupKey || null);
  return { id: Number(info.lastInsertRowid), created: true };
}

/**
 * 按规则扫描并生成到期通知：
 *  1) 漏服：活跃用药中，存在「今日已过点 yet 未完成」的 -> 每用户每天生成一条漏服通知（列出具体药品）
 *  2) 复诊日期进入前 3 天：next_visit_date 距今 1~3 天 -> 每个复诊日生成一条
 * @returns {number} 本次新生成的通知条数
 */
function generateDueNotifications(db) {
  const t = todayStr();
  const now = nowHHMM();
  let created = 0;

  // 1) 漏服：活跃用药中，存在「今日已过点 yet 未完成（无打卡记录或 taken=0）」的 -> 每样漏服药品各生成一条通知
  //    去重键按「药品 + 当天」，保证：① 当天漏用 N 样药 = N 条独立提醒；
  //    ② 上午漏 A、下午漏 B 这种跨时段漏用也能各自补提醒，不会因当天已通知而漏掉 B；
  //    ③ 同一药品当天不重复通知。
  const missedItems = db.prepare(`
    SELECT m.user_id AS uid, m.id AS medId, m.name AS name, m.time_slot AS timeSlot
    FROM medications m
    LEFT JOIN medication_logs l ON l.medication_id = m.id AND l.log_date = ?
    WHERE m.active = 1
      AND m.time_slot IS NOT NULL
      AND m.time_slot < ?
      AND COALESCE(l.taken, 0) = 0
    ORDER BY m.user_id, m.time_slot
  `).all(t, now);

  // 清理当天旧格式（按用户+当天合并）的漏服通知，避免与新的按药品通知冗余
  const affectedUids = [...new Set(missedItems.map(x => x.uid))];
  for (const uid of affectedUids) {
    db.prepare('DELETE FROM notifications WHERE dedup_key = ?').run(`missed-med:${uid}:${t}`);
  }

  for (const it of missedItems) {
    const res = createNotification(db, {
      userId: it.uid,
      type: '用药提醒',
      title: '药品漏服提醒',
      body: `您今日计划于 ${it.timeSlot} 使用的「${it.name}」已过点未使用，请尽快补用，避免影响治疗效果。`,
      dedupKey: `missed-med:${it.uid}:${it.medId}:${t}`
    });
    if (res.created) created++;
  }

  // 2) 复诊临近：next_visit_date 距今 1~3 天（进入「前 3 天」窗口）
  //    用 date() 截断到午夜；'now' 加 +8 hours 取北京时间，避免 UTC 服务器日期边界错位
  const visits = db.prepare(`
    SELECT id AS uid, next_visit_date AS d,
           CAST(julianday(date(next_visit_date)) - julianday(date('now','+8 hours')) AS INTEGER) AS days
    FROM users
    WHERE next_visit_date IS NOT NULL
      AND CAST(julianday(date(next_visit_date)) - julianday(date('now','+8 hours')) AS INTEGER) BETWEEN 1 AND 3
  `).all();
  for (const v of visits) {
    const res = createNotification(db, {
      userId: v.uid,
      type: '系统消息',
      title: '复诊临近提醒',
      body: `您将于 ${v.d} 复诊（还剩 ${v.days} 天），请提前做好准备。`,
      dedupKey: `followup:${v.uid}:${v.d}`
    });
    if (res.created) created++;
  }

  if (created > 0) console.log(`[notifications] 已自动生成 ${created} 条到期通知`);
  return created;
}

module.exports = { createNotification, generateDueNotifications };
