import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'florela.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL,
  product_id TEXT,
  product_json TEXT,
  vision_json TEXT,
  angles_json TEXT,
  video_json TEXT,
  carousel_json TEXT,
  render_json TEXT,
  feedback TEXT,
  utm_url TEXT,
  ig_media_id TEXT,
  error TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  usd REAL NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value),
  );
}

export function addCost(provider, model, usd, note = '') {
  db.prepare('INSERT INTO costs (day, provider, model, usd, note) VALUES (?, ?, ?, ?, ?)').run(today(), provider, model, usd, note);
}

export function costToday() {
  const row = db.prepare('SELECT COALESCE(SUM(usd), 0) AS total FROM costs WHERE day = ?').get(today());
  return Number(row.total);
}

export function assertBudget() {
  const spent = costToday();
  if (spent >= config.dailyBudgetUsd) {
    throw new Error(`Teto diário atingido: US$ ${spent.toFixed(2)} de US$ ${config.dailyBudgetUsd.toFixed(2)}`);
  }
}

const JSON_COLS = ['product_json', 'vision_json', 'angles_json', 'video_json', 'carousel_json', 'render_json'];

export function createRun(id) {
  db.prepare("INSERT INTO runs (id, status, updated_at) VALUES (?, 'created', datetime('now'))").run(id);
}

export function updateRun(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const values = keys.map((k) => (JSON_COLS.includes(k) && fields[k] !== null && typeof fields[k] !== 'string' ? JSON.stringify(fields[k]) : fields[k]));
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE runs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
}

export function getRun(id) {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  if (!row) return null;
  const run = { ...row };
  for (const col of JSON_COLS) {
    const key = col.replace(/_json$/, '');
    run[key] = row[col] ? JSON.parse(row[col]) : null;
  }
  return run;
}

export function recentRuns(limit = 5) {
  return db.prepare('SELECT id, created_at, status, product_id, error FROM runs ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function productUsedSince(productId, days) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE product_id = ? AND created_at >= datetime('now', ?) AND status != 'failed'")
    .get(productId, `-${days} days`);
  return Number(row.n) > 0;
}

export function runsSince(days) {
  return db.prepare("SELECT * FROM runs WHERE created_at >= datetime('now', ?) ORDER BY created_at").all(`-${days} days`);
}
