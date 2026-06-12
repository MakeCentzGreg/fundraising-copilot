// Company Intelligence Record — final spec section 5.
// Strategic synthesis layer between raw documents and every downstream
// consumer. MVP builds the 10-field subset (spec 5.2); the full 20-field
// schema (5.3) is documented but deferred.
import { callClaudeJSON } from './anthropic.js';

export const MVP_FIELDS = [
  'positioning_thesis',   // The category this company is claiming and why it wins
  'founder_edge',         // The capability no competitor can hire
  'timing_argument',      // The window that exists and why it closes
  'competitive_gap',      // The specific opening no incumbent fills
  'differentiation',      // Specific, defensible product edge
  'traction_signal',      // What the metrics prove about the business
  'capital_story',        // Why this raise, why now, what milestone it buys
  'primary_risk',         // Caleb's binding constraint in one sentence
  'investor_fit',         // Which VC type and thesis this company matches
  'governing_principle',  // The one-sentence strategic north star from Greg
];

const FIELD_GUIDE = `
positioning_thesis — The category this company is claiming and why it wins there. Not a tagline; the strategic claim.
founder_edge — The specific capability this founder has that no competitor can hire. The asymmetric advantage that compounds with time.
timing_argument — The market window that exists right now and why it closes. Why now, not two years ago or two years from now.
competitive_gap — The specific opening no incumbent fills, and why they structurally cannot fill it.
differentiation — The specific, defensible product edge. Mechanism-level, not adjective-level.
traction_signal — What the company's current metrics actually PROVE about the business, not just what they measure. If there is no traction yet, say what the strongest available evidence is.
capital_story — Why this amount, why now, what milestone it buys, and why that milestone unlocks the next round.
primary_risk — The binding constraint in one or two sentences, in honest unsoftened language (Caleb's framing).
investor_fit — Which type of VC and investment thesis this company matches (stage, sector, check size, thesis style).
governing_principle — The one-sentence strategic north star from the report's Governing Principle section.`;

const SYNTHESIS_SYSTEM = `You are the intelligence synthesis engine for a fundraising copilot.
You receive (a) confidence-scored fields extracted from a founder's documents and
(b) raw narrative sections from their CEO Syndicate evaluation report.

Synthesize the COMPANY INTELLIGENCE RECORD: strategic intelligence, not restated fields.
Each field captures what an investor actually needs to believe, grounded ONLY in the
provided material. Never invent facts, metrics, or claims not supported by the inputs.

Field definitions:
${FIELD_GUIDE}

Return ONLY valid JSON: an object with exactly these keys: ${MVP_FIELDS.join(', ')}.
Each key maps to:
{ "value": string | null, "confidence": number, "source_section": string, "source_asset": string, "rationale": string }

Confidence rules:
0.90+  Directly supported by explicit report content in 2+ places
0.70   Directly supported in one place
0.50   Synthesized from context — defensible but not explicit
0.30   Thin support — one of several readings
0.00   Cannot be grounded in the inputs (value must be null)

"source_section" names the input section(s) the value is grounded in (e.g. 'through_line', 'positioning_decision').
"source_asset" is the asset the grounding came from (e.g. 'greg_report').
"rationale" is one sentence: why this confidence score.
Write values as 1-3 tight sentences. No markdown inside values.`;

export async function synthesize(fused) {
  const { fields, sections } = fused;

  // Compact the field layer: only fields with content
  const fieldSummary = {};
  for (const [k, f] of Object.entries(fields)) {
    if (f.value != null && f.confidence > 0) {
      fieldSummary[k] = { value: f.value, confidence: f.confidence, source_asset: f.source_asset };
    }
  }

  const user = JSON.stringify({ extracted_fields: fieldSummary, narrative_sections: sections }, null, 1);

  const raw = await callClaudeJSON({
    system: SYNTHESIS_SYSTEM,
    user,
    maxTokens: 8192,
  });

  const record = {};
  for (const key of MVP_FIELDS) {
    const f = raw[key] ?? {};
    record[key] = {
      value: f.value ?? null,
      confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0,
      source_section: f.source_section ?? '',
      source_asset: f.source_asset ?? 'greg_report',
      rationale: f.rationale ?? '',
    };
  }

  const populated = MVP_FIELDS.filter((k) => record[k].value != null);
  const overall = populated.length
    ? populated.reduce((s, k) => s + record[k].confidence, 0) / populated.length
    : 0;

  return { record, overall_confidence: Number(overall.toFixed(3)), populated_count: populated.length };
}
