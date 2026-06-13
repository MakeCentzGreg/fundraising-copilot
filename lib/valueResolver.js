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

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

// Resolve the stored profile value for a classified key, or null if none.
export function resolveValue(key, profileValues = getProfileValues()) {
  const profileKey = CLASSIFIER_TO_PROFILE[key];
  if (!profileKey) return null;
  const v = profileValues[profileKey];
  return isEmpty(v) ? null : v;
}

// Decide how each classified mapping should be filled:
//   'file'    — route to fileRouter
//   'fill'    — direct value from the profile (returned in .value)
//   'compose' — needs the Answer Composer (unknown, or no stored value)
export function planFill(mappings, profileValues = getProfileValues()) {
  return mappings.map((m) => {
    if (m.is_file_field || m.field_type === 'file' || FILE_KEYS.has(m.key)) return { ...m, action: 'file' };
    if (!m.unknown) {
      const value = resolveValue(m.key, profileValues);
      if (value != null) return { ...m, action: 'fill', value };
    }
    return { ...m, action: 'compose' };
  });
}
