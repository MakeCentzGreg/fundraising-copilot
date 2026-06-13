// Value Resolver — bridges classifier data-model keys to the Founder Profile
// store and decides, per classified field, whether it fills directly from a
// stored value or needs the Answer Composer. Used by the pipeline (Week 6) and
// the form-engine test. Keeps the classifier's broad v4 key list decoupled from
// the profile's storage keys.
import { getProfileValues } from './founderProfile.js';

// Classifier key -> profile storage key. Keys not listed have no direct profile
// value (e.g. why_this_vc, anything_else) and route to the Answer Composer.
export const CLASSIFIER_TO_PROFILE = {
  company_name: 'company_name',
  company_website: 'company_website',
  stage: 'stage',
  one_liner: 'one_liner',
  sector_tags: 'sector_tags',
  preferred_name: 'preferred_name',
  founder_name: 'preferred_name',
  founder_email: 'email',
  founder_linkedin: 'linkedin_url',
  founders: 'founders',
  problem_statement: 'problem_statement',
  solution_description: 'solution_description',
  competitive_landscape: 'competitive_landscape',
  target_customer: 'target_customer',
  go_to_market: 'go_to_market',
  business_model: 'business_model',
  key_metrics: 'key_metrics',
  tam_description: 'tam_description',
  raise_amount: 'raise_amount',
  raise_instrument: 'raise_instrument',
  use_of_funds: 'use_of_funds',
};

// File keys are handled by fileRouter, never by text fill or composition.
export const FILE_KEYS = new Set(['pitch_deck_file', 'one_pager_file']);

// Keys whose stored value is prose that can directly answer a long-text
// question. A high-confidence match to one of these fills verbatim (preserving
// the founder's reviewed wording). Any other key in a long-text field — a data
// key like `founders`, or a loose/low-confidence match — goes to the Answer
// Composer to write a real answer instead of dumping a stray field value.
export const NARRATIVE_KEYS = new Set([
  'problem_statement', 'solution_description', 'competitive_landscape', 'target_customer',
  'go_to_market', 'business_model', 'key_metrics', 'tam_description', 'use_of_funds', 'one_liner',
]);
// Below this classifier confidence, a long-text match is treated as too loose
// to dump verbatim — compose instead. (e.g. "unfair advantage" -> competitive
// _landscape @0.52, "why this team" -> founders @0.72 both fall through here.)
const NARRATIVE_FILL_MIN = 0.85;

function isLongText(m) {
  return m.field_type === 'textarea';
}

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

// For a solo founder, the personal contact fields and Founder #1's record hold
// the same person. If the personal field is blank, fall back to the founder
// record so a contact answer is never left empty just because it was typed in
// the other place.
const FOUNDER0_FALLBACK = { email: 'email', preferred_name: 'name', linkedin_url: 'linkedin' };

// Resolve the stored profile value for a classified key, or null if none.
export function resolveValue(key, profileValues = getProfileValues()) {
  const profileKey = CLASSIFIER_TO_PROFILE[key];
  if (!profileKey) return null;
  const v = profileValues[profileKey];
  if (!isEmpty(v)) return v;
  const sub = FOUNDER0_FALLBACK[profileKey];
  const founder0 = Array.isArray(profileValues.founders) ? profileValues.founders[0] : null;
  const fallback = sub && founder0 ? founder0[sub] : null;
  return isEmpty(fallback) ? null : fallback;
}

// Decide how each classified mapping should be filled:
//   'file'    — route to fileRouter
//   'fill'    — direct value from the profile (returned in .value)
//   'compose' — needs the Answer Composer (unknown, or no stored value)
export function planFill(mappings, profileValues = getProfileValues()) {
  return mappings.map((m) => {
    if (m.is_file_field || m.field_type === 'file' || FILE_KEYS.has(m.key)) return { ...m, action: 'file' };
    // Unknown: only compose for open-ended (long-text) questions. A short field
    // we can't place (a Twitter URL, a niche data point) goes to manual entry —
    // never force-filled or prose-composed.
    if (m.unknown) return { ...m, action: isLongText(m) ? 'compose' : 'manual' };

    const value = resolveValue(m.key, profileValues);
    if (value == null) return { ...m, action: 'compose' };

    // Long-text questions: fill verbatim only for a confident narrative match;
    // otherwise compose a real answer rather than dumping a stray field value.
    if (isLongText(m) && !(NARRATIVE_KEYS.has(m.key) && m.confidence >= NARRATIVE_FILL_MIN)) {
      return { ...m, action: 'compose' };
    }
    return { ...m, action: 'fill', value };
  });
}
