// Answer Composer — final spec section 9.
// Drafts answers for VC form fields the classifier could not map (key 'unknown'
// or confidence < 0.40), AND for known keys that have no stored value. Uses the
// three-layer context (profile / Intelligence Record / raw report sections) and
// the founder's calibrated voice. Every composed answer carries key 'ai_composed'
// so the review screen forces explicit founder approval — it can never auto-fill.
import { callClaudeJSON } from './anthropic.js';
import { loadComposerContext } from './intelligenceContext.js';

// System prompt is built per-call so the founder's voice instruction can be
// injected (spec 9.3). Without a calibrated voice we omit the line entirely.
function buildSystem(voiceInstruction) {
  const voiceLine = voiceInstruction
    ? `  ${voiceInstruction}`
    : '  Write plainly, in a first-person founder voice. No corporate filler.';
  return `You are a startup fundraising writing assistant.
A founder is completing a VC intake form.

You have three context sources:
  Layer 1 — founder_context:      structured profile fields (factual)
  Layer 2 — intelligence_context: Company Intelligence Record (strategic)
  Layer 3 — report_context:       raw CEO Syndicate narrative sections

CONTEXT RULES:
  Factual questions -> Layer 1 only
  Strategic questions -> Layer 2 primary, Layer 3 as supporting depth
  Never copy Layer 3 language verbatim — rewrite in the founder's voice
  Never invent facts, metrics, or claims not present in the context

VOICE:
${voiceLine}

LENGTH:
  Short factual questions: 1-2 sentences
  Strategic questions: 2-4 sentences
  Open-ended: 3-5 sentences max

Return ONLY valid JSON:
{
  "answer": "...",
  "confidence": 0.00,
  "sources_used": ["intelligence.positioning_thesis", "report.through_line"],
  "flag": null
}

If you cannot produce a confident answer from the context provided,
return confidence < 0.5 and set flag to explain what's missing.`;
}

// Compose one answer. `context` is the bundle from loadComposerContext();
// pass it in explicitly so batches reuse a single load and tests can inject.
export async function composeAnswer(field, context, vcContext = {}) {
  const ctx = context ?? loadComposerContext();
  const system = buildSystem(ctx.voiceInstruction);

  const vc_focus = [vcContext.sector, vcContext.stage, vcContext.fund_name]
    .filter(Boolean).join(', ');

  const user = JSON.stringify({
    question: field.field_label,
    field_type: field.field_type ?? 'textarea',
    help_text: field.help_text ?? '',
    vc_focus,
    fund_thesis: vcContext.fund_thesis ?? '',
    founder_context: ctx.founder_context ?? {},
    intelligence_context: ctx.intelligence_context ?? {},
    report_context: ctx.report_context ?? {},
  });

  let raw;
  try {
    raw = await callClaudeJSON({ system, user, maxTokens: 1024 });
  } catch (err) {
    return shape(field, { answer: '', confidence: 0, sources_used: [], flag: `composer failed: ${err.message}` });
  }
  return shape(field, raw);
}

function shape(field, raw) {
  return {
    field_label: field.field_label,
    field_type: field.field_type ?? 'textarea',
    selector: field.selector ?? '',
    answer: typeof raw.answer === 'string' ? raw.answer.trim() : '',
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0,
    sources_used: Array.isArray(raw.sources_used) ? raw.sources_used : [],
    flag: raw.flag ?? null,
    key: 'ai_composed',  // always — triggers mandatory review (spec 5.4 / 11.1)
    from_cache: false,
  };
}

// Compose several fields against a single shared context load.
export async function composeBatch(fields, context, vcContext = {}) {
  const ctx = context ?? loadComposerContext();
  const out = [];
  for (const field of fields) {
    out.push(await composeAnswer(field, ctx, vcContext));
  }
  return out;
}
