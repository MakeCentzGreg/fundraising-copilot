// /api/submissions — the submission log / lightweight Investor CRM.
//   GET    -> list submissions (newest first) + the status vocabulary
//   PATCH  -> update a submission's status and/or notes ({ id, status?, notes? })
//   DELETE -> remove a submission ({ id })
import { NextResponse } from 'next/server';
import { loadSubmissions, updateSubmission, removeSubmission, STATUSES } from '@/lib/submissionLog';

export async function GET() {
  const submissions = loadSubmissions()
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));
  return NextResponse.json({ submissions, statuses: STATUSES });
}

export async function PATCH(request) {
  try {
    const { id, status, notes } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
    const entry = updateSubmission(id, { status, notes });
    if (!entry) return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, submission: entry });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  if (!removeSubmission(id)) return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
