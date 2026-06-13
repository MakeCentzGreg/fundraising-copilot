// Stores the most recent parse/hydration result so the review screen can
// show confidence, rationale, and tier for every extracted field.
// Local JSON file — simple and debuggable, per the MVP's local-first design.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'last_parse.json');

export function saveParseResult(result) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(result, null, 2));
}

export function loadParseResult() {
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Mark review-flagged fields the founder has confirmed or edited so the home
// page stops counting them as pending. Adds keys to a `resolved_review` set.
export function markReviewResolved(keys) {
  const result = loadParseResult();
  if (!result) return;
  const resolved = new Set(result.resolved_review ?? []);
  for (const k of keys) resolved.add(k);
  result.resolved_review = [...resolved];
  saveParseResult(result);
}
