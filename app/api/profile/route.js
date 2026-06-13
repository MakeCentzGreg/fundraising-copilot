// GET  /api/profile — full profile + hydration context + completeness
// POST /api/profile — write fields: { updates: [{ key, value, source }] }
//   source: 'manual' (founder typed/edited) or 'confirmed' (founder approved
//   a report-sourced value — stored as ceo_syndicate at high confidence)
import { NextResponse } from 'next/server';
import { getProfile, setField, missingRequiredFields, VOICE_OPTIONS } from '@/lib/founderProfile';
import { loadParseResult, markReviewResolved } from '@/lib/parseStore';

export async function GET() {
  const profile = getProfile();
  const parse = loadParseResult();
  return NextResponse.json({
    profile,
    missing: missingRequiredFields(),
    voices: VOICE_OPTIONS,
    hydration: parse?.hydration ?? null,
    resolved_review: parse?.resolved_review ?? [],
    parsed_at: parse?.parsed_at ?? null,
    overall_confidence: parse?.overall_confidence ?? null,
  });
}

export async function POST(request) {
  const body = await request.json();
  const updates = body.updates ?? [];
  for (const u of updates) {
    if (!u.key) continue;
    if (u.source === 'confirmed') {
      // Founder approved the report-sourced value as-is
      setField(u.key, u.value, 'ceo_syndicate', 0.95);
    } else {
      setField(u.key, u.value, 'manual', 1.0);
    }
  }
  // Any field the founder just confirmed/edited is no longer "pending review"
  markReviewResolved(updates.map((u) => u.key));
  return NextResponse.json({ ok: true, missing: missingRequiredFields() });
}
