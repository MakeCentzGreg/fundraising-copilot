// Profile Hydrator — final spec section 6.
// Routes fused extraction fields into the Founder Profile by confidence tier:
//   >= 0.90        auto  — write silently
//   0.60 – 0.89    review — write, flag for founder confirmation
//   <  0.60        blank — do not write, founder fills manually
import { setField } from './founderProfile.js';

export const TIER = { AUTO: 'auto', REVIEW: 'review', BLANK: 'blank' };

export function tierFor(confidence) {
  if (confidence >= 0.9) return TIER.AUTO;
  if (confidence >= 0.6) return TIER.REVIEW;
  return TIER.BLANK;
}

// Extraction keys (spec 8.3) → profile keys (spec 7.1). Keys not listed
// (e.g. governing_principle, readiness_verdict) stay in the Intelligence
// Record / narrative layer and never write to the profile.
const EXTRACTION_TO_PROFILE = {
  company_name: 'company_name',
  stage: 'stage',
  one_liner: 'one_liner',
  problem_statement: 'problem_statement',
  solution_description: 'solution_description',
  competitive_landscape: 'competitive_landscape',
  target_customer: 'target_customer',
  go_to_market: 'go_to_market',
  business_model: 'business_model',
  key_metrics: 'key_metrics',
  tam_description: 'tam_description',
  use_of_funds: 'use_of_funds',
  raise_amount_hint: 'raise_amount',
  founder_names: 'founders',
};

export function hydrateProfile(fusedFields, { write = true } = {}) {
  const report = { auto: [], review: [], blank: [], conflicts: [] };

  for (const [extractionKey, profileKey] of Object.entries(EXTRACTION_TO_PROFILE)) {
    const field = fusedFields[extractionKey];
    if (!field) continue;

    // Multi-asset conflicts always go to review, regardless of score (spec 6.3)
    const tier = field.conflict ? TIER.REVIEW : tierFor(field.confidence);
    const entry = {
      profileKey,
      extractionKey,
      value: field.value,
      confidence: field.confidence,
      source_section: field.source_section,
      source_asset: field.source_asset,
      rationale: field.rationale,
      conflict: !!field.conflict,
      tier,
    };

    if (field.conflict) report.conflicts.push(entry);

    if (tier === TIER.BLANK || field.value == null) {
      report.blank.push(entry);
      continue;
    }

    if (write) {
      // founder_names arrives as a string/array of names; store as founders[]
      const value =
        profileKey === 'founders' ? toFoundersArray(field.value) : field.value;
      setField(profileKey, value, 'ceo_syndicate', field.confidence);
    }
    report[tier === TIER.AUTO ? 'auto' : 'review'].push(entry);
  }

  return report;
}

function toFoundersArray(value) {
  const names = Array.isArray(value)
    ? value
    : String(value).split(/,|;|\band\b|&/).map((s) => s.trim()).filter(Boolean);
  return names.map((name) => ({ name, title: '', email: '', linkedin: '', bio: '' }));
}
