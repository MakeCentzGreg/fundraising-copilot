// Asset Parser — final spec section 8.
// PDF text extraction → confidence-scored field extraction → narrative
// section harvest (Greg report only) → multi-asset confidence fusion.
import { callClaudeJSON } from './anthropic.js';

export const ASSET_TYPES = ['greg_report', 'pitch_deck', 'investor_memo', 'one_pager'];

// The 20 extraction fields from spec section 8.3.
export const EXTRACTION_FIELDS = [
  'company_name', 'stage', 'one_liner', 'problem_statement',
  'solution_description', 'competitive_landscape', 'target_customer',
  'tam_description', 'business_model', 'go_to_market', 'key_metrics',
  'why_unique', 'why_now', 'positioning_statement', 'use_of_funds',
  'raise_amount_hint', 'founder_names', 'governing_principle',
  'readiness_verdict', 'next_move',
];

// ---------------------------------------------------------------------------
// PDF text extraction (pdfjs-dist)
// ---------------------------------------------------------------------------
export async function extractPdfText(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const getDocument = pdfjs.getDocument ?? pdfjs.default.getDocument;
  const doc = await getDocument(filePath).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n\n';
  }
  // CEO Syndicate PDFs split ligatures ("fi rst") and pad spaces. Collapse
  // runs of spaces; the LLM and the tolerant regexes handle the rest.
  return text.replace(/[ \t]{2,}/g, ' ');
}

// ---------------------------------------------------------------------------
// Confidence-scored structured field extraction (spec 8.3 prompt, verbatim
// rules; fields list shared with the classifier key list)
// ---------------------------------------------------------------------------
const EXTRACTION_SYSTEM = `Extract startup profile fields from this document.
Return ONLY valid JSON. No preamble or markdown.

The top-level JSON object must have one property per field listed below.
Each field must follow this exact shape:
{ "value": string | null, "confidence": number, "source_section": string, "source_asset": string, "rationale": string }

Confidence rules:
0.90+  Stated explicitly, consistent across 2+ sections
0.70   Stated explicitly in one section
0.50   Inferred from context — not stated directly
0.30   Ambiguous — one of several possible values
0.10   Present but contradicted elsewhere
0.00   Cannot reliably extract

If a field cannot be extracted, set value to null and confidence to 0.0.
"rationale" is one sentence explaining the confidence score.

Fields: ${EXTRACTION_FIELDS.join(', ')}`;

export async function extractStructuredFields(text, assetType) {
  const fields = await callClaudeJSON({
    system: EXTRACTION_SYSTEM,
    user: `source_asset: ${assetType}\n\nDOCUMENT:\n${text}`,
    maxTokens: 8192,
  });
  // Normalize: guarantee every expected field exists with the right shape.
  const out = {};
  for (const key of EXTRACTION_FIELDS) {
    const f = fields[key] ?? {};
    out[key] = {
      value: f.value ?? null,
      confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0,
      source_section: f.source_section ?? '',
      source_asset: assetType,
      rationale: f.rationale ?? '',
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Narrative section harvest — Greg report only (spec 8.4).
// Headers in extracted PDF text appear as markdown-ish "## Section Name"
// with unpredictable spacing, and evaluation blocks are delimited by
// letter-spaced banners like "E V A L U A T I O N 1 0".
// ---------------------------------------------------------------------------

// Build a regex source that tolerates arbitrary whitespace between words
// and optional hyphen/space variation.
function loosePhrase(phrase) {
  return phrase
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[-\\s]*'))
    .join('\\s+');
}

// Section header phrases as they appear inside report blocks.
const SECTION_PHRASES = {
  through_line: ['The Through-Line', 'Through-Line'],
  five_dimension: ['Five-Dimension Assessment', 'Five Dimension Assessment'],
  readiness_verdict: ['The Readiness Verdict', 'Readiness Verdict'],
  specific_gaps: ['Specific Gaps', 'Specific Gaps + Actions', 'Gaps and Actions'],
  situation_assessment: ['Situation Assessment'],
  engine_tension: ['Engine Tension'],
  founder_psych_edge: ['Founder Psychological Edge', 'Psychological Edge'],
  moment_of_incapability: ['Moment of Incapability'],
  governing_principle: ['Governing Principle'],
  next_move: ['Next Move'],
  long_arc_impact: ['Long Arc Impact', 'Long-Arc Impact', 'The Long Arc', 'Long Arc'],
};

// A header is "##" (1-3 hashes) or a bold/plain occurrence of the phrase.
function headerRegex(phrases) {
  const alts = phrases.map(loosePhrase).join('|');
  return new RegExp(`(?:#{1,4}\\s*|\\*\\*\\s*)?(?:${alts})\\s*(?:\\*\\*)?\\s*:?`, 'i');
}

// Any next-section boundary: a markdown header, a horizontal rule, or a
// letter-spaced page banner (e.g. "E V A L U A T I O N", "F I N A L  G A T E").
const BOUNDARY = /(?:#{1,4}\s+[A-Z*])|(?:---)|(?:(?:[A-Z]\s){3,}[A-Z])/g;

function sliceSection(blockText, phrases, maxLen = 4000) {
  const re = headerRegex(phrases);
  const m = re.exec(blockText);
  if (!m) return null;
  const start = m.index + m[0].length;
  BOUNDARY.lastIndex = start;
  const b = BOUNDARY.exec(blockText);
  const end = b ? b.index : Math.min(blockText.length, start + maxLen);
  const section = blockText.slice(start, end).trim();
  return section.length > 20 ? section.slice(0, maxLen) : null;
}

// Split the report into evaluation blocks keyed by their decision title.
export function splitEvaluationBlocks(text) {
  const bannerRe = /E\s*V\s*A\s*L\s*U\s*A\s*T\s*I\s*O\s*N\s+(\d(?:\s*\d)?)/g;
  const banners = [];
  let m;
  while ((m = bannerRe.exec(text)) !== null) {
    banners.push({ num: parseInt(m[1].replace(/\s+/g, ''), 10), index: m.index });
  }
  const blocks = {};
  for (let i = 0; i < banners.length; i++) {
    const start = banners[i].index;
    const end = i + 1 < banners.length ? banners[i + 1].index : text.length;
    blocks[banners[i].num] = text.slice(start, end);
  }
  return blocks;
}

function findBlockByTitle(blocks, titlePhrase) {
  const re = new RegExp(loosePhrase(titlePhrase), 'i');
  for (const num of Object.keys(blocks)) {
    // Only match the title in the first 300 chars (the banner area)
    if (re.test(blocks[num].slice(0, 300))) return blocks[num];
  }
  return null;
}

export function extractNarrativeSections(text) {
  const blocks = splitEvaluationBlocks(text);
  const synthesis = findBlockByTitle(blocks, 'Readiness Synthesis') ?? blocks[11] ?? text;
  const positioning = findBlockByTitle(blocks, 'Positioning Decision');
  const fundraising = findBlockByTitle(blocks, 'Fundraising Decision');

  const sections = {};

  // Synthesis-sourced sections
  for (const key of ['through_line', 'five_dimension', 'readiness_verdict', 'specific_gaps', 'governing_principle', 'next_move', 'long_arc_impact']) {
    const v = sliceSection(synthesis, SECTION_PHRASES[key]);
    if (v) sections[key] = v;
  }

  // Per-decision sections: prefer positioning, then fundraising, then anywhere
  for (const key of ['situation_assessment', 'engine_tension']) {
    const v =
      (positioning && sliceSection(positioning, SECTION_PHRASES[key])) ||
      (fundraising && sliceSection(fundraising, SECTION_PHRASES[key])) ||
      sliceSection(text, SECTION_PHRASES[key]);
    if (v) sections[key] = v;
  }

  // Lens sections: anywhere in the report (Kirk / Lance outputs)
  for (const key of ['founder_psych_edge', 'moment_of_incapability']) {
    const v = sliceSection(text, SECTION_PHRASES[key]);
    if (v) sections[key] = v;
  }

  // Full decision outputs, raw
  if (positioning) sections.positioning_decision = positioning.slice(0, 12000);
  if (fundraising) sections.fundraising_decision = fundraising.slice(0, 12000);

  return sections;
}

// ---------------------------------------------------------------------------
// Multi-asset confidence fusion (spec 6.3)
// ---------------------------------------------------------------------------
function normalizeValue(v) {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function fuseConfidenceScores(parsedAssets) {
  const fused = {};
  const allSections = {};

  for (const parsed of parsedAssets) {
    Object.assign(allSections, parsed.sections ?? {});
    for (const [key, field] of Object.entries(parsed.fields)) {
      if (field.value == null || field.confidence === 0) continue;
      const existing = fused[key];
      if (!existing) {
        fused[key] = { ...field, conflict: false };
        continue;
      }
      const same = normalizeValue(existing.value) === normalizeValue(field.value);
      if (same) {
        // Agreement: higher confidence + 0.10 bonus, capped at 1.0
        const winner = field.confidence > existing.confidence ? field : existing;
        fused[key] = {
          ...winner,
          confidence: Math.min(1, Math.max(existing.confidence, field.confidence) + 0.1),
          rationale: `${winner.rationale} (confirmed by ${existing.source_asset === winner.source_asset ? field.source_asset : existing.source_asset})`,
          conflict: false,
        };
      } else {
        // Conflict: max(score1, score2) × 0.70, flag for founder review
        const winner = field.confidence > existing.confidence ? field : existing;
        const loser = winner === field ? existing : field;
        fused[key] = {
          ...winner,
          confidence: Math.max(existing.confidence, field.confidence) * 0.7,
          rationale: `Sources disagree: ${winner.source_asset} says "${String(winner.value).slice(0, 60)}", ${loser.source_asset} says "${String(loser.value).slice(0, 60)}"`,
          conflict: true,
        };
      }
    }
  }

  // Carry empty fields through so downstream consumers see the full shape
  for (const key of EXTRACTION_FIELDS) {
    if (!fused[key]) {
      fused[key] = { value: null, confidence: 0, source_section: '', source_asset: '', rationale: 'Not found in any asset', conflict: false };
    }
  }

  return { fields: fused, sections: allSections };
}

// ---------------------------------------------------------------------------
// Top-level parse API (spec 8.2)
// ---------------------------------------------------------------------------
export async function parseAsset(filePath, assetType) {
  const text = await extractPdfText(filePath);
  const fields = await extractStructuredFields(text, assetType);
  const sections = assetType === 'greg_report' ? extractNarrativeSections(text) : {};
  return { assetType, filePath, fields, sections, textLength: text.length };
}

export async function parseAllAssets(assets) {
  const parsed = [];
  for (const a of assets) {
    parsed.push(await parseAsset(a.path, a.type));
  }
  return fuseConfidenceScores(parsed);
}
