'use client';
// Submission log / lightweight Investor CRM — who you've submitted to, when,
// and where each relationship stands. Update status and jot notes per VC.
//
// Accessibility: status is shown as icon + word, never color alone.
import { useEffect, useState } from 'react';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Submissions() {
  const [data, setData] = useState(null); // { submissions, statuses }
  const [notesDraft, setNotesDraft] = useState({}); // id -> notes being edited
  const [saved, setSaved] = useState({}); // id -> true briefly after a note save

  async function load() {
    const r = await fetch('/api/submissions');
    const d = await r.json();
    setData(d);
    setNotesDraft(Object.fromEntries(d.submissions.map((s) => [s.id, s.notes ?? ''])));
  }
  useEffect(() => { load().catch(() => setData({ submissions: [], statuses: [] })); }, []);

  const statuses = data?.statuses ?? [];
  function statusMeta(key) { return statuses.find((s) => s.key === key) ?? { label: key, icon: '•' }; }

  async function setStatus(id, status) {
    await fetch('/api/submissions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
    await load();
  }
  async function saveNotes(id) {
    await fetch('/api/submissions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, notes: notesDraft[id] ?? '' }) });
    setSaved((p) => ({ ...p, [id]: true }));
    setTimeout(() => setSaved((p) => ({ ...p, [id]: false })), 1500);
  }
  async function remove(id) {
    await fetch('/api/submissions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    await load();
  }

  const subs = data?.submissions ?? [];

  // Pipeline summary by status.
  const counts = {};
  for (const s of subs) counts[s.status] = (counts[s.status] ?? 0) + 1;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">Your submissions</h1>
      <p className="mt-2 text-slate-600">
        Every VC you’ve submitted to, and where each one stands. Update the status
        as you hear back, and keep notes per fund.
      </p>

      {data == null ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : subs.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-slate-600">No submissions yet.</p>
          <a href="/submit" className="mt-3 inline-block rounded-xl bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800">
            Submit your first form →
          </a>
        </div>
      ) : (
        <>
          {/* Pipeline summary */}
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold">{subs.length} total</span>
            {statuses.filter((s) => counts[s.key]).map((s) => (
              <span key={s.key} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                <span aria-hidden="true">{s.icon}</span> {counts[s.key]} {s.label.toLowerCase()}
              </span>
            ))}
          </div>

          <ul className="mt-6 space-y-3">
            {subs.map((s) => {
              const meta = statusMeta(s.status);
              return (
                <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{s.vc_name || s.domain || 'Unknown VC'}</div>
                      <div className="text-sm text-slate-500">
                        Submitted {fmtDate(s.submitted_at)} · {s.fields_filled} fields
                        {s.deck_label ? ` · ${s.deck_label}` : ' · no deck'}
                        {s.ai_composed_count ? ` · ${s.ai_composed_count} AI-drafted` : ''}
                      </div>
                      {s.vc_url && <div className="mt-0.5 truncate text-xs text-slate-400">{s.vc_url}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`status-${s.id}`}>Status</label>
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-sm font-semibold text-slate-800">
                        <span aria-hidden="true">{meta.icon}</span> {meta.label}
                      </span>
                      <select id={`status-${s.id}`} value={s.status} onChange={(e) => setStatus(s.id, e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white p-1.5 text-sm">
                        {statuses.map((st) => <option key={st.key} value={st.key}>{st.icon} {st.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3">
                    <textarea
                      className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                      rows={2}
                      placeholder="Notes — intro path, who you spoke to, follow-ups…"
                      value={notesDraft[s.id] ?? ''}
                      onChange={(e) => setNotesDraft((p) => ({ ...p, [s.id]: e.target.value }))}
                      onBlur={() => { if ((notesDraft[s.id] ?? '') !== (s.notes ?? '')) saveNotes(s.id); }}
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        {s.status_updated_at && s.status !== 'submitted' ? `Status updated ${fmtDate(s.status_updated_at)}` : ''}
                        {saved[s.id] ? '✓ Note saved' : ''}
                      </span>
                      <button onClick={() => remove(s.id)} className="text-xs text-slate-400 underline hover:text-red-700">remove</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-8">
        <a href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Back to home</a>
      </div>
    </div>
  );
}
