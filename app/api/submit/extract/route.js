// POST /api/submit/extract — Step 3+4 backend.
// Loads the VC form, extracts fields, classifies, composes answers, and returns
// the review payload. Keeps the browser open under a session id for commit.
import { NextResponse } from 'next/server';
import { startSession } from '@/lib/pipelineSession';

export const maxDuration = 600;

export async function POST(request) {
  try {
    const { url, fund_name, fund_focus } = await request.json();
    if (!url || !/^https?:|^file:/.test(url)) {
      return NextResponse.json({ error: 'Enter a valid form URL (http(s):// …).' }, { status: 400 });
    }
    const [sector, stage] = (fund_focus ?? '').split(',').map((s) => s.trim());
    const out = await startSession(url, { fund_name, fund_thesis: fund_focus, sector, stage });
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    console.error('extract route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
