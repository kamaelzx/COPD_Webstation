const { hashPassword } = require('./util/crypto');
const { beijingDate } = require('./util/time');

// 种子数据：仅在 users 表为空时灌入（保证重启不丢用户数据）
function seed(db) {
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (cnt > 0) return;

  const dayStr = (offset) => beijingDate(offset); // 北京时间日期，offset 天前

  const insUser = db.prepare(
    `INSERT INTO users (name, avatar_initial, gender, birthday, diagnosis, stage, phone, password_hash, lang, manage_days, next_visit_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const userId = insUser.run('张伯', '张', '男', '1958-03-12', 'COPD', '稳定期', '13800000000', hashPassword('123456'), 'zh', 218, '2026-07-26').lastInsertRowid;

  const insMed = db.prepare(
    `INSERT INTO medications (user_id, name, dose, frequency, time_slot, start_date, active)
     VALUES (?,?,?,?,?,?,1)`
  );
  const med1 = insMed.run(userId, '信必可吸入剂', '160/4.5μg × 2 吸', '每日 2 次', '08:00', '2026-01-01').lastInsertRowid;
  const med2 = insMed.run(userId, '噻托溴铵粉吸入剂', '18μg × 1 吸', '每日 1 次', '14:00', '2026-01-01').lastInsertRowid;

  // 近 7 天打卡：信必可全勤，噻托溴铵缺 1 天 -> 依从性 13/14 ≈ 93%
  const insLog = db.prepare(
    `INSERT OR IGNORE INTO medication_logs (medication_id, user_id, log_date, scheduled_time, taken, taken_at)
     VALUES (?,?,?,?,?,?)`
  );
  for (let i = 0; i < 7; i++) {
    insLog.run(med1, userId, dayStr(i), '08:00', 1, dayStr(i) + ' 08:05');
    if (i !== 1) {
      insLog.run(med2, userId, dayStr(i), '14:00', 1, dayStr(i) + ' 14:10');
    }
  }

  const insTip = db.prepare('INSERT INTO health_tips (category, title, content) VALUES (?,?,?)');
  insTip.run('用药知识', '吸入后请漱口', '吸入后请及时用清水漱口，可明显减少口腔真菌感染与声音嘶哑的发生。');
  insTip.run('呼吸锻炼', '缩唇呼吸', '吸气 2 秒，缩唇如吹口哨缓慢呼气 4–6 秒，每日练习可改善通气。');
  insTip.run('戒烟', '戒烟是关键', '戒烟是延缓 COPD 进展最有效的措施，任何阶段戒烟都有获益。');
  insTip.run('营养', '高蛋白饮食', '慢阻肺患者易消瘦，建议适量增加优质蛋白与维生素摄入。');

  const insSch = db.prepare('INSERT INTO pharmacist_schedule (day_of_week, session, location, note) VALUES (?,?,?,?)');
  insSch.run('周一至周五', '上午', '门诊一楼药学门诊诊室', '免挂号费 / 请携带既往病历和药品');
  insSch.run('周六', '上午', '门诊二楼用药咨询窗', '仅复诊取药咨询');

  const insArt = db.prepare('INSERT INTO science_articles (title, category, summary, type) VALUES (?,?,?,?)');
  insArt.run('吸入剂正确使用 6 步法', '用药指导', '摇、呼气、含住、深吸、屏气、漱口，逐步演示。', 'article');
  insArt.run('慢阻肺居家肺康复操', '呼吸康复', '肩臂舒展 + 缩唇呼吸，适合每日居家练习。', 'video');
  insArt.run('急性加重的早期识别', '疾病管理', '痰量骤增、气促加重、脓性痰，需及时就医。', 'article');

  const insPost = db.prepare('INSERT INTO forum_posts (user_id, title, body) VALUES (?,?,?)');
  insPost.run(userId, '冬天怎么预防感冒？', '一到冬天就犯病，大家有什么好办法吗？');
  insPost.run(userId, '分享我的呼吸操打卡', '坚持一个月，爬楼没那么喘了。');

  const insRec = db.prepare('INSERT INTO health_records (user_id, type, title, record_date, detail) VALUES (?,?,?,?,?)');
  insRec.run(userId, '检查报告', '肺功能检查 (2026-04)', '2026-04-10', 'FEV1/FVC < 70%，中度阻塞。');
  insRec.run(userId, '随访记录', '门诊随访 (2026-05)', '2026-05-20', '用药方案维持，症状平稳。');

  const insNotif = db.prepare('INSERT INTO notifications (user_id, type, title, body, is_read) VALUES (?,?,?,?,?)');
  insNotif.run(userId, '用药提醒', '今日用药待完成', '噻托溴铵粉吸入剂 14:00 尚未使用。', 0);
  insNotif.run(userId, '系统消息', '复诊提醒', '您将于 2026-07-26 到期复诊。', 0);
  insNotif.run(userId, '系统消息', '欢迎使用', '欢迎使用 COPD 慢病管理平台。', 1);

  const insPt = db.prepare('INSERT INTO points_log (user_id, delta, reason) VALUES (?,?,?)');
  insPt.run(userId, 100, '连续用药 7 天');
  insPt.run(userId, 80, '完成呼吸操打卡');
  insPt.run(userId, 60, '参与随访');
  insPt.run(userId, 120, '完善健康档案');

  console.log('[seed] 已灌入演示数据 (用户: 张伯 / 手机: 13800000000)');
}

module.exports = { seed };
