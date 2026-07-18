// 统一北京时间（GMT+8）工具。
// 中国不实行夏令时，+8 全年恒定，故直接用固定偏移，无需 Intl/时区库。
// 用途：所有「今天日期」「当前时间」一律走北京时间，避免部署在 UTC 服务器时
//       日期边界落在北京时间 08:00（即 UTC 午夜）导致的打卡/通知错算。
const OFFSET_MS = 8 * 3600 * 1000;

// 北京时间日期 "YYYY-MM-DD"。offsetDays: 相对今天偏移天数（负=未来，正=过去）
function beijingDate(offsetDays = 0) {
  const d = new Date(Date.now() + OFFSET_MS - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

// 北京时间 "HH:MM"
function beijingTime() {
  const d = new Date(Date.now() + OFFSET_MS);
  return d.toISOString().slice(11, 16);
}

module.exports = { beijingDate, beijingTime, OFFSET_MS };
