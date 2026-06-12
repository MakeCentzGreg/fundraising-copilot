// Milestone 1 test — Acceptance Tests 1, 2, 3 (final spec section 2).
// Usage: node scripts/testParse.js [path-to-greg-report.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { parseAsset, fuseConfidenceScores } from '../lib/assetParser.js';
import { synthesize, MVP_FIELDS } from '../lib/intelligenceRecord.js';
import { hydrateProfile } from '../lib/profileHydrator.js';
import { getDb, newId } from '../lib/db.js';

const DEFAULT_REPORT = 'C:/Users/grego/OneDrive/Desktop/Fundraising Copilot/greg-full-report-Kirk_Lance_Caleb_syntheses_per-lens_headlines.pdf';
const reportPath = process.argv[2] ?? DEFAULT_REPORT;

// Acceptance Test 1: required profile fields the report is expected to fill
const REQUIRED_FROM_REPORT = [
  'company_name', 'stage', 'one_liner', 'problem_statement',
  'solution_description', 'competitive_landscape', 'target_customer', 'go_to_market',
];

function pct(n) { return `${Math.round(n * 100)}%`; }
function pass(ok) { return ok ? 'PASS' : 'FAIL'; }

const out = { started_at: new Date().toISOString(), report: reportPath };

console.log('=== Step 1: Parse Greg report ===');
const parsed = await parseAsset(reportPath, 'greg_report');
console.log(`Text length: ${parsed.textLength} chars`);
console.log(`Narrative sections found: ${Object.keys(parsed.sections).length}`);
for (const [k, v] of Object.entries(parsed.sections)) {
  console.log(`  - ${k}: ${v.length} chars | "${v.slice(0, 70).replace(/\s+/g, ' ')}..."`);
}

const fused = fuseConfidenceScores([parsed]);
console.log('\n=== Extracted fields (confidence-scored) ===');
for (const [k, f] of Object.entries(fused.fields)) {
  const v = f.value == null ? '(null)' : `"${String(f.value).slice(0, 60).replace(/\s+/g, ' ')}"`;
  console.log(`  ${k.padEnd(24)} ${String(f.confidence).padEnd(5)} ${v}`);
}

// --- Acceptance Test 1: >= 80% of required fields at confidence >= 0.60
const got = REQUIRED_FROM_REPORT.filter((k) => fused.fields[k]?.value != null && fused.fields[k].confidence >= 0.6);
const at1 = got.length / REQUIRED_FROM_REPORT.length >= 0.8;
console.log(`\nAcceptance Test 1 — ${pass(at1)}: ${got.length}/${REQUIRED_FROM_REPORT.length} required fields extracted at >= 0.60 (need 80%)`);
if (!at1) {
  const missing = REQUIRED_FROM_REPORT.filter((k) => !got.includes(k));
  console.log(`  Missing/low-confidence: ${missing.join(', ')}`);
}

console.log('\n=== Step 2: Synthesize Intelligence Record ===');
const synth = await synthesize(fused);
for (const k of MVP_FIELDS) {
  const f = synth.record[k];
  const v = f.value == null ? '(null)' : `"${String(f.value).slice(0, 70).replace(/\s+/g, ' ')}..."`;
  console.log(`  ${k.padEnd(22)} ${String(f.confidence).padEnd(5)} [${f.source_section}] ${v}`);
}
console.log(`Overall confidence: ${synth.overall_confidence}`);

// --- Acceptance Test 3: all 10 MVP fields populated with value + confidence + source
const at3 = MVP_FIELDS.every((k) => {
  const f = synth.record[k];
  return f.value != null && f.confidence > 0 && f.source_section !== '';
});
console.log(`\nAcceptance Test 3 — ${pass(at3)}: ${synth.populated_count}/10 Intelligence Record fields populated with value, confidence, and source`);

console.log('\n=== Step 3: Hydrate Founder Profile (three-tier routing) ===');
const hydration = hydrateProfile(fused.fields, { write: true });
console.log(`  AUTO   (>=0.90, written silently):   ${hydration.auto.map((e) => e.profileKey).join(', ') || '(none)'}`);
console.log(`  REVIEW (0.60-0.89, flagged):         ${hydration.review.map((e) => e.profileKey).join(', ') || '(none)'}`);
console.log(`  BLANK  (<0.60, left empty):          ${hydration.blank.map((e) => e.profileKey).join(', ') || '(none)'}`);

// --- Acceptance Test 2: tiers route correctly (verify against the scores)
const tierErrors = [];
for (const list of ['auto', 'review', 'blank']) {
  for (const e of hydration[list]) {
    const expected = e.conflict ? 'review' : e.confidence >= 0.9 ? 'auto' : e.confidence >= 0.6 ? 'review' : 'blank';
    if (expected !== list) tierErrors.push(`${e.profileKey}: conf ${e.confidence} in ${list}, expected ${expected}`);
  }
}
const at2 = tierErrors.length === 0 && (hydration.auto.length + hydration.review.length + hydration.blank.length) > 0;
console.log(`\nAcceptance Test 2 — ${pass(at2)}: three-tier routing ${tierErrors.length === 0 ? 'consistent' : 'errors: ' + tierErrors.join('; ')}`);

// --- Persist: asset row + intelligence record row
const db = getDb();
const assetId = newId('asset');
db.prepare('INSERT INTO intelligence_assets (id, uploaded_at, asset_type, file_path, parse_status, is_active) VALUES (?, ?, ?, ?, ?, 1)')
  .run(assetId, new Date().toISOString(), 'greg_report', reportPath, 'parsed');
db.prepare('UPDATE intelligence_record SET is_active = 0').run();
db.prepare('INSERT INTO intelligence_record (id, synthesized_at, source_asset_ids, overall_confidence, record_json, is_active) VALUES (?, ?, ?, ?, ?, 1)')
  .run(newId('rec'), new Date().toISOString(), JSON.stringify([assetId]), synth.overall_confidence, JSON.stringify(synth.record));

// Save full outputs for inspection
out.sections = parsed.sections;
out.fields = fused.fields;
out.intelligence_record = synth.record;
out.hydration = hydration;
out.acceptance = { test1: at1, test2: at2, test3: at3 };
fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'data', 'milestone1_output.json'), JSON.stringify(out, null, 2));

console.log('\n=== MILESTONE 1 SUMMARY ===');
console.log(`Test 1 (extraction >= 80%):        ${pass(at1)}`);
console.log(`Test 2 (three-tier routing):       ${pass(at2)}`);
console.log(`Test 3 (Intelligence Record 10/10): ${pass(at3)}`);
console.log('Full output: data/milestone1_output.json');
process.exit(at1 && at2 && at3 ? 0 : 1);
