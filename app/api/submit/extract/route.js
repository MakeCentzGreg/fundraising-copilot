// POST /api/submit/extract — Step 3+4 backend.
// Loads the VC form, extracts fields, classifies, composes answers, and returns
// the review payload. Keeps the browser open under a session id for commit.
import { NextResponse } from 'next/server';
import { startSession } from '@/lib/pipelineSession';
import { isDuplicateSubmission } from '@/lib/submissionLog';

export const maxDuration = 600;

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

export async function POST(request) {
  try {
    const { url, fund_name, fund_focus, force } = await request.json();
    if (!url || !/^https?:|^file:/.test(url)) {
      return NextResponse.json({ error: 'Enter a valid form URL (http(s):// …).' }, { status: 400 });
    }

    // Duplicate guard (spec 5.6): warn before doing any extraction work, unless
    // the founder already chose to continue.
    if (!force) {
      const prior = isDuplicateSubmission(domainOf(url));
      if (prior) {
        return NextResponse.json({
          ok: true,
          duplicate: { domain: prior.domain, submitted_at: prior.submitted_at, status: prior.status, vc_name: prior.vc_name },
        });
      }
    }

    const [sector, stage] = (fund_focus ?? '').split(',').map((s) => s.trim());
    const out = await startSession(url, { fund_name, fund_thesis: fund_focus, sector, stage });
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    console.error('extract route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
