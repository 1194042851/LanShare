import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, INTERNAL_DIR } from './config.js';

for (const dir of [DATA_DIR, INTERNAL_DIR]) fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'lanshare.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    rel        TEXT NOT NULL,
    kind       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shares_rel ON shares(rel);
`);

export const stmt = {
  insertShare: db.prepare('INSERT INTO shares (id, rel, kind, created_at) VALUES (?, ?, ?, ?)'),
  getShare: db.prepare('SELECT * FROM shares WHERE id = ?'),
  allShares: db.prepare('SELECT * FROM shares ORDER BY created_at DESC'),
  deleteShare: db.prepare('DELETE FROM shares WHERE id = ?'),
  deleteSharesUnder: db.prepare('DELETE FROM shares WHERE rel = ? OR rel LIKE ?'),
};
