// Classifier — final spec section 10.2 (carries v1 logic, v4 key list).
// Maps each extracted form field to a data-model key using Claude.
// Manages session-level duplicate-key prevention, confidence scoring, and an
// in-memory mapping cache. Fields it cannot place (confidence < 0.40) return
// key 'unknown' and are routed to the Answer Composer by the pipeline.
import crypto from 'node:crypto';
import { callClaudeJSON } from './anthropic.js';

// Full v4 data-model key list. Forms map to one of these keys; a key with no
// stored value (e.g. why_this_vc) still classifies here, then the pipeline
// either fills it from the profile or hands it to the Answer Composer.
export const DATA_MODEL_KEYS = [
  // Company identity
  'company_name', 'company_website', 'incorporation_state', 'stage', 'founded_year', 'hq_location',
  // Founder / contact
  'preferred_name', 'founder_email', 'founder_title', 'founder_linkedin', 'team_size', 'founders',
  // Problem & solution
  'problem_statement', 'solution_description', 'sector_tags', 'technology_type', 'one_liner',
  // Traction
  'revenue_range', 'revenue_arr', 'customer_count', 'key_metrics', 'business_model', 'unit_economics',
  // Market
  'tam_description', 'target_customer', 'competitive_landscape', 'go_to_market',
  // Fundraise
  'raise_amount', 'raise_instrument', 'use_of_funds', 'runway_months', 'prior_funding',
  // Assets
  'pitch_deck_file', 'one_pager_file', 'demo_video_url',
  // Open / contextual
  'why_this_vc', 'anything_else',
];

const SYSTEM = `You are a VC form field classifier. Your job is to map a single
form field to the best matching key from a startup data model.

You will receive a JSON object describing one form field: its label,
type, help text, placeholder, section context, and position.

Return ONLY a JSON object in this exact format —
no explanation, no preamble, no markdown:
{
  "key": "data_model_key",
  "confidence": 0.00,
  "reasoning": "one sentence max"
}

VALID KEYS (you must return one of these, or 'unknown'):
${DATA_MODEL_KEYS.join(', ')}

CLASSIFICATION RULES:
1. Use section_header to resolve ambiguous labels.
   'Tell us about your team' under 'Founders' -> founders.
   Same label under 'Traction' -> key_metrics.
2. field_type=file -> must map to pitch_deck_file or one_pager_file only.
3. Open-ended catch-all fields -> anything_else unless context
   strongly suggests why_this_vc.
4. Numeric fields with revenue framing -> revenue_arr.
   If options provided (dropdown) -> revenue_range.
5. Confidence < 0.4 -> return key: 'unknown'.
6. Never return a key from already_used_keys.
7. Social links are platform-specific. founder_linkedin is LinkedIn ONLY. A field
   for X/Twitter, Facebook, Instagram, GitHub, YouTube, TikTok, or any other
   platform has NO matching key — return 'unknown'. Never map one platform's
   field to another platform's key.
8. Only map a field to a key when it genuinely asks for that thing. If the closest
   key is a different concept, return 'unknown' rather than force-fitting it.`;

// Confidence thresholds (spec 10.2)
function flagsFor(key, confidence) {
  const unknown = key === 'unknown' || confidence < 0.4;
  return {
    auto_fill: !unknown && confidence >= 0.9,
    needs_review: !unknown && confidence >= 0.4 && confidence < 0.9,
    unknown,
  };
}

// In-memory cache (spec: swap for Redis/SQLite in production).
// Key = SHA256(domain + label + type + section), first 16 chars.
const cache = new Map();

function cacheKey(domain, field) {
  const raw = `${domain}|${field.field_label}|${field.field_type}|${field.section_header ?? ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function cacheMapping(domain, field, key, confidence, source = 'classified') {
  cache.set(cacheKey(domain, field), { key, confidence, source });
}

export async function classifyField(field, { domain = '', usedKeys = new Set() } = {}) {
  const ck = cacheKey(domain, field);
  const cached = cache.get(ck);
  if (cached && !usedKeys.has(cached.key)) {
    return buildResult(field, cached.key, cached.confidence, 'from cache', true);
  }

  const user = JSON.stringify({
    field_label: field.field_label,
    field_type: field.field_type,
    help_text: field.help_text ?? '',
    placeholder: field.placeholder ?? '',
    section_header: field.section_header ?? '',
    options: field.options ?? [],
    position_in_form: field.position_in_form ?? 0,
    total_fields: field.total_fields ?? 0,
    already_used_keys: [...usedKeys],
  });

  let raw;
  try {
    raw = await callClaudeJSON({ system: SYSTEM, user, maxTokens: 256 });
  } catch {
    return buildResult(field, 'unknown', 0, 'classifier call failed', false);
  }

  let key = typeof raw.key === 'string' ? raw.key : 'unknown';
  let confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  // Defend the dedup rule even if the model ignores it.
  if (usedKeys.has(key)) { key = 'unknown'; confidence = 0; }
  if (!DATA_MODEL_KEYS.includes(key)) key = 'unknown';

  const result = buildResult(field, key, confidence, raw.reasoning ?? '', false);

  // Cache warm: high-confidence results auto-populate the cache (spec).
  if (!result.unknown && confidence >= 0.85) cacheMapping(domain, field, key, confidence, 'classified');

  return result;
}

function buildResult(field, key, confidence, reasoning, fromCache) {
  const flags = flagsFor(key, confidence);
  return {
    field_label: field.field_label,
    field_type: field.field_type,
    selector: field.selector ?? '',
    key: flags.unknown ? 'unknown' : key,
    confidence,
    reasoning,
    from_cache: fromCache,
    ...flags,
  };
}

// Classify a whole form. Maintains a usedKeys Set so two fields never map to
// the same key — the second-best match is found instead (spec 10.2).
export async function classifyForm(fields, domain = '') {
  const usedKeys = new Set();
  const mappings = [];
  for (const field of fields) {
    const r = await classifyField(field, { domain, usedKeys });
    if (!r.unknown) usedKeys.add(r.key);
    mappings.push(r);
  }
  return {
    domain,
    mappings,
    auto_count: mappings.filter((m) => m.auto_fill).length,
    review_count: mappings.filter((m) => m.needs_review).length,
    unknown_count: mappings.filter((m) => m.unknown).length,
  };
}
