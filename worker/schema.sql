-- AnimifyAI D1 Schema v2
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  password_hash TEXT,
  avatar TEXT,
  credits INTEGER DEFAULT 0,
  plan TEXT DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (email) REFERENCES users(email)
);

CREATE TABLE IF NOT EXISTS ip_usage (
  ip TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  PRIMARY KEY (ip, date)
);

CREATE TABLE IF NOT EXISTS flux_state (
  date TEXT PRIMARY KEY,
  exhausted INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS free_usage (
  fp TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
