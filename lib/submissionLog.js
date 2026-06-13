// Submission log — final spec section 13 (local JSON, no DB needed for MVP).
// Appends one record per submitted form to data/submissions.json. Also mirrors
// a minimal row into the submissions table so the DB stays consistent.
import fs from 'node:fs';
import path from 'node:path';
import { getDb, newId } from './db.js';

const FILE = path.join(process.cwd(), 'data', 'submissions.json');

export function logSubmission(record) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const all = loadSubmissions();
  const entry = { id: newId('sub'), submitted_at: new Date().toISOString(), status: 'submitted', ...record };
  all.push(entry);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));

  try {
    getDb().prepare(
      'INSERT INTO submissions (id, vc_name, vc_url, submitted_at, status) VALUES (?, ?, ?, ?, ?)'
    ).run(entry.id, entry.vc_name ?? entry.domain ?? '', entry.vc_url ?? '', entry.submitted_at, 'submitted');
  } catch { /* JSON log is the source of truth for MVP */ }

  return entry;
}

export function loadSubmissions() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}
