// Submission log — final spec section 13 (local JSON, no DB needed for MVP).
// Appends one record per submitted form to data/submissions.json and supports
// lightweight per-VC status tracking + notes (the start of the Investor CRM,
// spec section 5.6). Also mirrors a minimal row into the submissions table.
import fs from 'node:fs';
import path from 'node:path';
import { getDb, newId } from './db.js';

const FILE = path.join(process.cwd(), 'data', 'submissions.json');

// Founder-settable relationship stages, in pipeline order. Each carries an icon
// so the UI never relies on color alone (Greg is colorblind).
export const STATUSES = [
  { key: 'submitted', label: 'Submitted', icon: '📤' },
  { key: 'replied', label: 'Replied', icon: '✉' },
  { key: 'meeting', label: 'Meeting', icon: '📅' },
  { key: 'due_diligence', label: 'Due diligence', icon: '🔍' },
  { key: 'passed', label: 'Passed', icon: '✕' },
  { key: 'invested', label: 'Invested', icon: '★' },
];
const STATUS_KEYS = new Set(STATUSES.map((s) => s.key));

export function loadSubmissions() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function saveSubmissions(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function logSubmission(record) {
  const all = loadSubmissions();
  const entry = {
    id: newId('sub'),
    submitted_at: new Date().toISOString(),
    status: 'submitted',
    status_updated_at: new Date().toISOString(),
    notes: '',
    ...record,
  };
  all.push(entry);
  saveSubmissions(all);

  try {
    getDb().prepare(
      'INSERT INTO submissions (id, vc_name, vc_url, submitted_at, status) VALUES (?, ?, ?, ?, ?)'
    ).run(entry.id, entry.vc_name ?? entry.domain ?? '', entry.vc_url ?? '', entry.submitted_at, 'submitted');
  } catch { /* JSON log is the source of truth for MVP */ }

  return entry;
}

// Update a submission's status and/or notes (Investor CRM, spec 5.6).
export function updateSubmission(id, { status, notes } = {}) {
  const all = loadSubmissions();
  const entry = all.find((s) => s.id === id);
  if (!entry) return null;
  if (status !== undefined) {
    if (!STATUS_KEYS.has(status)) throw new Error(`Unknown status: ${status}`);
    entry.status = status;
    entry.status_updated_at = new Date().toISOString();
    try { getDb().prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, id); } catch { /* JSON is source of truth */ }
  }
  if (notes !== undefined) entry.notes = notes;
  saveSubmissions(all);
  return entry;
}

export function removeSubmission(id) {
  const all = loadSubmissions();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  saveSubmissions(next);
  try { getDb().prepare('DELETE FROM submissions WHERE id = ?').run(id); } catch { /* best effort */ }
  return true;
}

// Most recent submission to a given domain (newest first).
export function getByDomain(domain) {
  return loadSubmissions().filter((s) => s.domain === domain)
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));
}

// Duplicate guard (spec 5.6): the most recent prior submission to this domain
// within `days`, or null. Any logged status counts — we only log on submit.
export function isDuplicateSubmission(domain, days = 90) {
  if (!domain) return null;
  const prior = getByDomain(domain)[0];
  if (!prior) return null;
  const ageMs = Date.now() - Date.parse(prior.submitted_at);
  return ageMs <= days * 24 * 60 * 60 * 1000 ? prior : null;
}
