// POST /api/submit/commit — Step 5 backend.
// Fills approved/edited values, uploads the deck, submits the form, and logs the
// submission. The founder review gate is enforced client-side; the server fills
// only the values it is handed and skips the rest.
import { NextResponse } from 'next/server';
import { commitSession, cancelSession } from '@/lib/pipelineSession';

export const maxDuration = 600;

export async function POST(request) {
  try {
    const { session_id, approvals = {}, skipped = [], cancel } = await request.json();
    if (!session_id) return NextResponse.json({ error: 'Missing session_id.' }, { status: 400 });
    if (cancel) { await cancelSession(session_id); return NextResponse.json({ ok: true, cancelled: true }); }
    const result = await commitSession(session_id, approvals, skipped);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('commit route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
