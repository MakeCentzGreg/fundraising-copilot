// Intelligence Context loader — assembles the Answer Composer's three context
// layers (final spec section 9.1) from the founder's stored data.
//   Layer 1 — founder_context:      structured profile fields (factual)
//   Layer 2 — intelligence_context: Company Intelligence Record (strategic)
//   Layer 3 — report_context:       raw CEO Syndicate narrative sections
// Plus the founder's voice instruction, injected into the composer prompt.
import { getDb } from './db.js';
import { getProfileValues, getField, VOICE_OPTIONS } from './founderProfile.js';
import { loadParseResult } from './parseStore.js';

const MAX_SECTION_CHARS = 1800; // keep Layer 3 prompt-sized; sections can be long

// Layer 2 — load the active Intelligence Record from the DB, falling back to
// the last parse result on disk. Returns { key: { value, confidence } }.
export function loadIntelligenceRecord() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT record_json FROM intelligence_record WHERE is_active = 1 ORDER BY synthesized_at DESC').get();
    if (row?.record_json) return JSON.parse(row.record_json);
  } catch { /* fall through to disk */ }
  return loadParseResult()?.intelligence_record ?? {};
}

// Layer 3 — raw narrative sections from the last parse (Greg Report only).
export function loadReportSections() {
  return loadParseResult()?.sections ?? {};
}

export function voiceInstruction() {
  const key = getField('voice_preference')?.value;
  return VOICE_OPTIONS[key]?.instruction ?? '';
}

// Build the full context bundle the Answer Composer consumes.
export function loadComposerContext() {
  const record = loadIntelligenceRecord();
  const sections = loadReportSections();

  // Layer 2: drop source/rationale to keep the prompt lean — value + confidence
  // are what the composer needs.
  const intelligence_context = {};
  for (const [k, f] of Object.entries(record)) {
    if (f && f.value != null) intelligence_context[k] = { value: f.value, confidence: f.confidence ?? 0 };
  }

  // Layer 3: truncate each section so the prompt stays bounded.
  const report_context = {};
  for (const [k, text] of Object.entries(sections)) {
    if (typeof text === 'string' && text.trim()) {
      report_context[k] = text.length > MAX_SECTION_CHARS ? `${text.slice(0, MAX_SECTION_CHARS)}…` : text;
    }
  }

  return {
    founder_context: getProfileValues(), // Layer 1
    intelligence_context,                // Layer 2
    report_context,                      // Layer 3
    voiceInstruction: voiceInstruction(),
  };
}
