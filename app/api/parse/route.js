// POST /api/parse — Step 1+2 backend.
// Accepts multipart upload (greg_report required, others optional), runs the
// full intelligence pipeline, hydrates the profile, returns the hydration
// report for the review screen.
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { parseAsset, fuseConfidenceScores, ASSET_TYPES } from '@/lib/assetParser';
import { synthesize } from '@/lib/intelligenceRecord';
import { hydrateProfile } from '@/lib/profileHydrator';
import { getDb, newId } from '@/lib/db';
import { saveParseResult } from '@/lib/parseStore';
import { setField } from '@/lib/founderProfile';

export const maxDuration = 600;

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

export async function POST(request) {
  try {
    const form = await request.formData();

    // Collect uploaded files keyed by asset type
    const assets = [];
    for (const type of ASSET_TYPES) {
      const file = form.get(type);
      if (file && typeof file !== 'string' && file.size > 0) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        const safeName = `${type}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(UPLOAD_DIR, safeName);
        fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));
        assets.push({ type, path: filePath, originalName: file.name });
      }
    }

    if (!assets.some((a) => a.type === 'greg_report')) {
      return NextResponse.json({ error: 'A CEO Syndicate report (Greg Report) is required.' }, { status: 400 });
    }

    const db = getDb();
    const assetIds = [];

    // Parse each asset, tracking status in the DB
    const parsed = [];
    for (const a of assets) {
      const id = newId('asset');
      assetIds.push(id);
      db.prepare(
        'INSERT INTO intelligence_assets (id, uploaded_at, asset_type, file_path, parse_status, is_active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run(id, new Date().toISOString(), a.type, a.path, 'parsing');
      try {
        parsed.push(await parseAsset(a.path, a.type));
        db.prepare('UPDATE intelligence_assets SET parse_status = ? WHERE id = ?').run('parsed', id);
      } catch (err) {
        db.prepare('UPDATE intelligence_assets SET parse_status = ? WHERE id = ?').run('failed', id);
        throw new Error(`Could not parse ${a.originalName}: ${err.message}`);
      }
    }

    // An uploaded pitch deck doubles as the founder's deck asset (spec 7.1)
    const deck = assets.find((a) => a.type === 'pitch_deck');
    if (deck) {
      setField(
        'pitch_decks',
        [{ label: deck.originalName, path: deck.path, tags: [], version: 'v1', is_default: true, last_updated: new Date().toISOString() }],
        'manual',
        1.0
      );
    }

    // Fuse → synthesize Intelligence Record → hydrate profile
    const fused = fuseConfidenceScores(parsed);
    const synth = await synthesize(fused);
    const hydration = hydrateProfile(fused.fields, { write: true });

    // Persist the active Intelligence Record
    db.prepare('UPDATE intelligence_record SET is_active = 0').run();
    db.prepare(
      'INSERT INTO intelligence_record (id, synthesized_at, source_asset_ids, overall_confidence, record_json, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(newId('rec'), new Date().toISOString(), JSON.stringify(assetIds), synth.overall_confidence, JSON.stringify(synth.record));

    const result = {
      parsed_at: new Date().toISOString(),
      assets: assets.map((a, i) => ({ type: a.type, name: a.originalName, id: assetIds[i] })),
      fields: fused.fields,
      sections: fused.sections,
      intelligence_record: synth.record,
      overall_confidence: synth.overall_confidence,
      hydration,
    };
    saveParseResult(result);

    return NextResponse.json({
      ok: true,
      hydration,
      overall_confidence: synth.overall_confidence,
      record_fields_populated: synth.populated_count,
      sections_found: Object.keys(fused.sections).length,
    });
  } catch (err) {
    console.error('parse route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
