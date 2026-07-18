const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'data', 'copd.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// 迁移：为已存在的旧库补 password_hash 列（新库由 schema.sql 直接建好）
const { hashPassword } = require('./util/crypto');
const cols = db.prepare('PRAGMA table_info(users)').all();
if (!cols.some((c) => c.name === 'password_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
}
// 回填：旧的免密用户（张伯等）赋予默认密码 123456，保证仍可登录
const legacy = db.prepare("SELECT id FROM users WHERE password_hash IS NULL OR password_hash=''").all();
if (legacy.length) {
  const upd = db.prepare('UPDATE users SET password_hash=? WHERE id=?');
  const DEFAULT_PW = hashPassword('123456');
  for (const u of legacy) upd.run(DEFAULT_PW, u.id);
  console.log(`[migrate] 已为 ${legacy.length} 个旧用户设置默认密码 123456`);
}

// 迁移：为已存在的旧库补 notifications.dedup_key 列（新库由 schema.sql 直接建好）
const noteCols = db.prepare('PRAGMA table_info(notifications)').all();
if (!noteCols.some((c) => c.name === 'dedup_key')) {
  db.exec('ALTER TABLE notifications ADD COLUMN dedup_key TEXT');
  console.log('[migrate] 已为 notifications 表补 dedup_key 列');
}

// 首次运行灌入种子数据
const { seed } = require('./seed');
seed(db);

module.exports = db;
