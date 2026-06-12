// Founder Profile — final spec section 7.1.
// Canonical data store. Every field carries source + confidence.
// founders[] and pitch_decks[] are stored as JSON strings under their keys.
import { getDb } from './db.js';

// Required-field groups (spec 7.1). 'report' = CEO Syndicate populates,
// 'founder' = direct founder input, 'mixed' = report first, founder completes.
export const PROFILE_GROUPS = {
  personal: { source: 'founder', fields: ['preferred_name', 'email', 'linkedin_url'] },
  company: { source: 'mixed', fields: ['company_name', 'company_website', 'stage', 'sector_tags', 'one_liner'] },
  team: { source: 'mixed', fields: ['founders'] }, // founders[] JSON array
  business: { source: 'report', fields: ['problem_statement', 'solution_description', 'competitive_landscape', 'target_customer', 'go_to_market'] },
  fundraise: { source: 'founder', fields: ['raise_amount', 'raise_instrument', 'use_of_funds'] },
  assets: { source: 'founder', fields: ['pitch_decks'] }, // pitch_decks[] JSON array
};

export const VOICE_OPTIONS = {
  direct: {
    label: 'Direct and concise',
    description: 'Short sentences. Active verbs. No hedging. The data speaks.',
    instruction: 'Write in short declarative sentences. Omit filler. Lead with the claim, follow with the evidence.',
  },
  visionary: {
    label: 'Visionary and narrative',
    description: 'Category thinking. The big picture before the details.',
    instruction: 'Open with the category thesis. Frame every answer around the larger transformation, then ground it.',
  },
  technical: {
    label: 'Technical and precise',
    description: 'Specific numbers. Mechanism first. Jargon appropriate for domain.',
    instruction: 'Use domain-specific language. Include specific metrics, mechanisms, and technical differentiation.',
  },
  warm: {
    label: 'Warm and relational',
    description: 'Patient-proximate. Human stakes. The people behind the numbers.',
    instruction: 'Anchor every answer in the human problem. Make the mission gravity felt before the market size.',
  },
};

export function setField(key, value, source, confidence) {
  const db = getDb();
  const stored = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare(
    `INSERT INTO founder_profile (key, value, source, confidence, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, source=excluded.source,
       confidence=excluded.confidence, updated_at=excluded.updated_at`
  ).run(key, stored, source, confidence ?? null, new Date().toISOString());
}

export function getField(key) {
  const db = getDb();
  return db.prepare('SELECT * FROM founder_profile WHERE key = ?').get(key) ?? null;
}

export function getProfile() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM founder_profile').all();
  const profile = {};
  for (const row of rows) {
    let value = row.value;
    if (value && (value.startsWith('[') || value.startsWith('{'))) {
      try { value = JSON.parse(value); } catch { /* keep as string */ }
    }
    profile[row.key] = { value, source: row.source, confidence: row.confidence, updated_at: row.updated_at };
  }
  return profile;
}

// Flat { key: value } view for the form engine / answer composer (Layer 1).
export function getProfileValues() {
  const profile = getProfile();
  const out = {};
  for (const [k, v] of Object.entries(profile)) out[k] = v.value;
  return out;
}

export function missingRequiredFields() {
  const profile = getProfile();
  const missing = [];
  for (const [group, def] of Object.entries(PROFILE_GROUPS)) {
    for (const f of def.fields) {
      const v = profile[f]?.value;
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) missing.push({ group, field: f });
    }
  }
  return missing;
}
