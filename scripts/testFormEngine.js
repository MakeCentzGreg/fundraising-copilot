// Weeks 4-5 milestone test (final spec section 13).
// Extract the local iGan form -> classify every field -> compose answers for
// the novel ones -> verify the deck-upload path. Never touches a real VC form.
// Run Milestone 1 first so an Intelligence Record exists.
// Usage: node scripts/testFormEngine.js
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { extractForm } from '../lib/domExtractor.js';
import { classifyForm } from '../lib/classifier.js';
import { composeBatch } from '../lib/answerComposer.js';
import { loadComposerContext } from '../lib/intelligenceContext.js';
import { planFill } from '../lib/valueResolver.js';
import { selectAsset, executeUpload } from '../lib/fileRouter.js';

const FORM = pathToFileURL(path.resolve('test/fixtures/igan-form.html')).href;
const DECK = path.resolve('test/fixtures/sample-deck.pdf');
const VC_CONTEXT = { sector: 'Fintech / impact', stage: 'Seed', fund_name: 'iGan Partners',
  fund_thesis: 'Early-stage software with measurable social return' };

function pass(ok) { return ok ? 'PASS' : 'FAIL'; }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(FORM);

// --- Phase 1: extract ------------------------------------------------------
console.log('=== Phase 1: DOM extraction ===');
const { platform, domain, fields } = await extractForm(page);
console.log(`Platform: ${platform} | domain: ${domain} | fields: ${fields.length}\n`);
for (const f of fields) {
  console.log(`  [${String(f.position_in_form).padStart(2)}] ${f.field_type.padEnd(9)} ${f.required ? 'req ' : '    '} "${f.field_label}"` +
    `${f.section_header ? `  §${f.section_header}` : ''}${f.options.length ? `  opts:[${f.options.join('|')}]` : ''}`);
}
const fileFields = fields.filter((f) => f.is_file_field);
const at5 = fields.length >= 10 && fileFields.length === 1 &&
  fields.some((f) => f.field_type === 'select') && fields.every((f) => f.field_label && f.selector);
console.log(`\nAcceptance Test 5 — ${pass(at5)}: extracted ${fields.length} fields incl. ${fileFields.length} file + ` +
  `${fields.filter((f) => f.field_type === 'select').length} dropdown, all labelled with selectors`);

// --- Phase 2a: classify ----------------------------------------------------
console.log('\n=== Phase 2a: Classification ===');
const { mappings, auto_count, review_count, unknown_count } = await classifyForm(fields, domain);
for (const m of mappings) {
  const tag = m.auto_fill ? 'AUTO ' : m.needs_review ? 'REVIEW' : 'UNKNOWN';
  console.log(`  ${tag.padEnd(7)} ${String(Math.round(m.confidence * 100) + '%').padStart(4)}  "${m.field_label}" -> ${m.key}`);
}
console.log(`\nCounts — auto: ${auto_count}, review: ${review_count}, unknown: ${unknown_count}`);

// --- Phase 2: plan how each field is filled --------------------------------
// Resolver decides per field: 'file' -> fileRouter, 'fill' -> direct stored
// value, 'compose' -> Answer Composer (unknown, or no stored value).
const plan = planFill(mappings);
const fillFields = plan.filter((p) => p.action === 'fill');
const composeFields = plan.filter((p) => p.action === 'compose');
const fileFieldsPlanned = plan.filter((p) => p.action === 'file');
console.log('\n=== Phase 2: Fill plan ===');
console.log(`  Direct fill (${fillFields.length}): ${fillFields.map((p) => p.key).join(', ')}`);
console.log(`  Compose (${composeFields.length}):     ${composeFields.map((p) => p.key === 'unknown' ? `${p.field_label}?` : p.key).join(', ')}`);
console.log(`  File (${fileFieldsPlanned.length}):        ${fileFieldsPlanned.map((p) => p.field_label).join(', ')}`);

console.log('\n=== Phase 2b: Answer Composer ===');
const ctx = loadComposerContext();
const composed = await composeBatch(composeFields, ctx, VC_CONTEXT);
for (const c of composed) {
  console.log(`  "${c.field_label}" (${Math.round(c.confidence * 100)}%)`);
  console.log(`     ${c.answer.replace(/\s+/g, ' ')}`);
  console.log(`     sources: ${c.sources_used.join(', ') || '(none)'}${c.flag ? `  | FLAG: ${c.flag}` : ''}\n`);
}
const composedOk = composed.length > 0 &&
  composed.every((c) => c.answer && c.key === 'ai_composed' && c.field_type !== 'file') &&
  fileFieldsPlanned.every((p) => !composeFields.includes(p)); // no file field composed

// --- Phase 3 (path check): deck selection + upload -------------------------
console.log('=== Phase 3: Deck upload path ===');
const assets = [{ key: 'pitch_deck_file', label: 'MakeCentz Seed Deck', path: DECK,
  tags: ['seed', 'fintech'], version: 'v1', is_default: true, last_updated: '2026-06-01' }];
const fileMapping = mappings.find((m) => m.key === 'pitch_deck_file') || { selector: '#deck', key: 'pitch_deck_file', accepted_types: ['pdf', 'ppt', 'pptx'] };
const asset = selectAsset('pitch_deck_file', assets, VC_CONTEXT);
const upload = await executeUpload(page, fileMapping.selector, asset, { accepted_types: fileMapping.accepted_types });
const attached = await page.$eval('#deck', (el) => el.files.length).catch(() => 0);
console.log(`  selected: ${asset?.label} | upload: ${JSON.stringify(upload)} | files attached to input: ${attached}`);
const uploadOk = upload.success && attached === 1;

await browser.close();

// --- Summary ---------------------------------------------------------------
console.log('\n=== WEEKS 4-5 MILESTONE SUMMARY ===');
console.log(`Test 5 (form extraction):           ${pass(at5)}`);
console.log(`Classification ran (auto+review+unknown = ${auto_count + review_count + unknown_count}/${fields.length})`);
console.log(`Fill plan (fill/compose/file):      ${fillFields.length}/${composeFields.length}/${fileFieldsPlanned.length}`);
console.log(`Answer Composer (no file leakage):  ${pass(composedOk)} (${composed.length} composed)`);
console.log(`Deck selection + upload path:       ${pass(uploadOk)}`);
const ok = at5 && composedOk && uploadOk && (auto_count + review_count) > 0;
console.log(`\nMilestone: ${pass(ok)}`);
process.exit(ok ? 0 : 1);
