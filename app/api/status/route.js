// GET /api/status — pipeline progress for the home page stepper.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProfile, missingRequiredFields } from '@/lib/founderProfile';
import { loadParseResult } from '@/lib/parseStore';

export async function GET() {
  const db = getDb();
  const assets = db.prepare("SELECT * FROM intelligence_assets WHERE is_active = 1 AND parse_status = 'parsed'").all();
  const record = db.prepare('SELECT id, synthesized_at, overall_confidence FROM intelligence_record WHERE is_active = 1').get() ?? null;
  const submissions = db.prepare('SELECT COUNT(*) AS n FROM submissions').get();
  const profile = getProfile();
  const missing = missingRequiredFields();
  const parse = loadParseResult();

  return NextResponse.json({
    report_uploaded: assets.some((a) => a.asset_type === 'greg_report'),
    assets: assets.map((a) => ({ type: a.asset_type, uploaded_at: a.uploaded_at })),
    intelligence_record: record,
    profile_field_count: Object.keys(profile).length,
    voice_set: !!profile.voice_preference?.value,
    missing_required: missing,
    review_pending: (parse?.hydration?.review ?? []).filter(
      (e) => !(parse?.resolved_review ?? []).includes(e.profileKey)
    ).length,
    submissions: submissions.n,
  });
}
