PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar_initial TEXT,
  gender TEXT,
  birthday TEXT,
  diagnosis TEXT,
  stage TEXT,
  phone TEXT UNIQUE,
  password_hash TEXT,
  lang TEXT DEFAULT 'zh',
  manage_days INTEGER DEFAULT 0,
  next_visit_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  time_slot TEXT,
  start_date TEXT,
  end_date TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS medication_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  log_date TEXT NOT NULL,
  scheduled_time TEXT,
  taken INTEGER DEFAULT 0,
  taken_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(medication_id, log_date),
  FOREIGN KEY (medication_id) REFERENCES medications(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS health_tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  title TEXT,
  content TEXT,
  published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pharmacist_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week TEXT,
  session TEXT,
  location TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  pharmacist_id INTEGER,
  scheduled_at TEXT,
  status TEXT DEFAULT 'pending',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS science_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  category TEXT,
  cover TEXT,
  summary TEXT,
  content TEXT,
  type TEXT DEFAULT 'article',
  url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT,
  body TEXT,
  likes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forum_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  title TEXT,
  record_date TEXT,
  detail TEXT,
  file_path TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  title TEXT,
  body TEXT,
  is_read INTEGER DEFAULT 0,
  dedup_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  delta INTEGER DEFAULT 0,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
