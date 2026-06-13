// Milestone (Weeks 4-5) test — Acceptance Test 6 (final spec sections 2 & 9.4).
// Generates answers for the 10 MVP VC question types using the stored
// Company Intelligence Record + profile + raw report sections.
// Run Milestone 1 first (node scripts/testParse.js) so the record exists.
// Usage: node scripts/testCompose.js
import { composeAnswer } from '../lib/answerComposer.js';
import { loadComposerContext } from '../lib/intelligenceContext.js';

// The 10 question types the Composer must handle (spec 9.4), each tagged with
// the context layers it should lean on so we can eyeball that sources match.
const QUESTIONS = [
  { q: 'What problem are you solving?',                 expect: 'L1 problem_statement + L2 positioning_thesis' },
  { q: 'Why now?',                                      expect: 'L2 timing_argument + L3 through_line' },
  { q: 'Why are you uniquely positioned to solve this?',expect: 'L2 founder_edge + L3 founder_psych_edge' },
  { q: 'What insight do competitors miss?',             expect: 'L2 competitive_gap + L3 engine_tension' },
  { q: 'Describe your go-to-market.',                   expect: 'L1 go_to_market + L2 distribution_thesis' },
  { q: 'What is your business model?',                  expect: 'L1 business_model + L2 capital_story' },
  { q: 'What are you raising and why?',                 expect: 'L1 raise_amount + L2 capital_story' },
  { q: 'What is your biggest risk?',                    expect: 'L2 primary_risk + L3 specific_gaps' },
  { q: 'Why this fund?',                                expect: 'L2 investor_fit + vcContext', vc: true },
  { q: 'Anything else you want us to know?',            expect: 'L2 governing_principle + L3 next_move' },
];

const VC_CONTEXT = { sector: 'Fintech / impact', stage: 'Seed', fund_name: 'iGan Partners',
  fund_thesis: 'Early-stage software with measurable social return' };

function pass(ok) { return ok ? 'PASS' : 'FAIL'; }

const ctx = loadComposerContext();
const recordFields = Object.keys(ctx.intelligence_context).length;
const sectionCount = Object.keys(ctx.report_context).length;
if (recordFields === 0) {
  console.error('No Intelligence Record found. Run: node scripts/testParse.js first.');
  process.exit(1);
}
console.log(`Context loaded — profile fields: ${Object.keys(ctx.founder_context).length}, ` +
  `intelligence fields: ${recordFields}, report sections: ${sectionCount}, ` +
  `voice: ${ctx.voiceInstruction ? 'set' : 'default'}\n`);

const results = [];
for (const { q, expect, vc } of QUESTIONS) {
  const r = await composeAnswer({ field_label: q, field_type: 'textarea' }, ctx, vc ? VC_CONTEXT : {});
  results.push({ q, ...r });
  console.log(`Q: ${q}`);
  console.log(`   expected layers: ${expect}`);
  console.log(`   answer (${Math.round(r.confidence * 100)}%): ${r.answer.replace(/\s+/g, ' ')}`);
  console.log(`   sources: ${r.sources_used.join(', ') || '(none)'}${r.flag ? `  | FLAG: ${r.flag}` : ''}`);
  console.log(`   key: ${r.key}\n`);
}

// Acceptance Test 6: each of the 10 produces a usable, sourced answer.
// Pass per-question = non-empty answer, confidence >= 0.5, >= 1 source cited.
const verdicts = results.map((r) => ({
  q: r.q,
  ok: r.answer.length > 0 && r.confidence >= 0.5 && r.sources_used.length > 0 && r.key === 'ai_composed',
}));
const passed = verdicts.filter((v) => v.ok).length;
const at6 = passed === QUESTIONS.length;

console.log('=== Acceptance Test 6 — Answer generation (10 question types) ===');
for (const v of verdicts) console.log(`  ${pass(v.ok)}  ${v.q}`);
console.log(`\nAcceptance Test 6 — ${pass(at6)}: ${passed}/${QUESTIONS.length} question types produced usable, sourced answers`);
process.exit(at6 ? 0 : 1);
