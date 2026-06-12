// SQLite storage — final spec section 12, using Node's built-in sqlite
// (no native build step needed). The DB file lives in copilot-app/data/.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'copilot.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS founder_profile (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  source      TEXT,    -- 'ceo_syndicate' | 'manual' | 'ai_composed'
  confidence  REAL,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS intelligence_assets (
  id           TEXT PRIMARY KEY,
  uploaded_at  TEXT,
  asset_type   TEXT,   -- 'greg_report' | 'pitch_deck' | 'investor_memo' | 'one_pager'
  file_path    TEXT,
  parse_status TEXT,   -- 'pending' | 'parsing' | 'parsed' | 'failed'
  is_active    INTEGER
);

CREATE TABLE IF NOT EXISTS intelligence_record (
  id                 TEXT PRIMARY KEY,
  synthesized_at     TEXT,
  source_asset_ids   TEXT,  -- JSON array
  overall_confidence REAL,
  record_json        TEXT,  -- Full CompanyIntelligenceRecord as JSON
  is_active          INTEGER
);

CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  vc_name      TEXT,
  vc_url       TEXT,
  submitted_at TEXT,
  status       TEXT   -- 'submitted' only for MVP
);
`;

let db = null;

export function getDb() {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(SCHEMA);
  }
  return db;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
