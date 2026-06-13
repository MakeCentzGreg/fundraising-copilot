'use client';
// Steps 3-5 of the five-step flow: paste a VC form URL -> review every answer
// (auto-filled / from report / AI-drafted / needs approval / manual / file) ->
// approve, edit, or skip -> submit.
//
// Accessibility: every section badge is icon + text, never color alone (Greg is
// colorblind). The AI-drafted section is additionally labelled in words.
// Trust gate: the submit button is disabled until every AI-drafted, needs-
// approval, and manual field is approved, edited, or explicitly skipped.
import { useState } from 'react';

// Section metadata. `gate: true` means items here block submission until resolved.
const SECTIONS = {
  needs_approval: { badge: { icon: '?', text: 'Please confirm', cls: 'border-amber-400 bg-amber-50 text-amber-900' },
    title: 'Needs your confirmation', gate: true, border: 'border-amber-300' },
  ai_composed: { badge: { icon: '✦', text: 'AI-generated — review before sending', cls: 'border-violet-400 bg-violet-100 text-violet-900' },
    title: 'AI-drafted answers', gate: true, border: 'border-violet-400', bg: 'bg-violet-50' },
  manual: { badge: { icon: '✎', text: 'You fill this in', cls: 'border-slate-400 bg-slate-100 text-slate-800' },
    title: 'Manual — we couldn’t answer these', gate: true, border: 'border-slate-300' },
  report: { badge: { icon: '◆', text: 'From your report', cls: 'border-teal-400 bg-teal-50 text-teal-900' },
    title: 'Pulled from your report', gate: false, border: 'border-teal-300' },
  auto: { badge: { icon: '✓', text: 'Filled automatically', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
    title: 'Auto-filled (high confidence)', gate: false, border: 'border-slate-200' },
  file: { badge: { icon: '📎', text: 'Deck upload', cls: 'border-blue-300 bg-blue-50 text-blue-900' },
    title: 'File upload', gate: false, border: 'border-blue-200' },
};
const ORDER = ['needs_approval', 'ai_composed', 'manual', 'report', 'auto', 'file'];

function Badge({ kind }) {
  const b = SECTIONS[kind].badge;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}>
      <span aria-hidden="true">{b.icon}</span> {b.text}
    </span>
  );
}

export default function Submit() {
  const [phase, setPhase] = useState('url'); // url | extracting | review | submitting | done
  const [form, setForm] = useState({ url: '', fund_name: '', fund_focus: '' });
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null); // { id, platform, domain, field_count, review }
  const [values, setValues] = useState({});     // selector -> working value
  const [status, setStatus] = useState({});     // selector -> 'approved' | 'edited' | 'skipped'
  const [result, setResult] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  async function runExtract(force) {
    setError(null);
    setPhase('extracting');
    try {
      const r = await fetch('/api/submit/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, force }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Extraction failed');
      if (d.duplicate) { setDuplicate(d.duplicate); setPhase('duplicate'); return; }
      setSession(d);
      const v = {}, st = {};
      for (const it of d.review) {
        v[it.selector] = it.value ?? '';
        // auto/report/file start resolved; gated sections start unresolved
        if (!SECTIONS[it.section].gate) st[it.selector] = 'approved';
      }
      setValues(v); setStatus(st);
      setPhase('review');
    } catch (err) { setError(err.message); setPhase('url'); }
  }

  function handleExtract(e) {
    e.preventDefault();
    if (!form.url) { setError('Paste the VC form URL first.'); return; }
    runExtract(false);
  }

  function setVal(sel, val) {
    setValues((p) => ({ ...p, [sel]: val }));
    setStatus((p) => ({ ...p, [sel]: 'edited' }));
  }
  function approve(sel) { setStatus((p) => ({ ...p, [sel]: 'approved' })); }
  function skip(sel) { setStatus((p) => ({ ...p, [sel]: 'skipped' })); }

  const review = session?.review ?? [];
  const gated = review.filter((it) => SECTIONS[it.section].gate);
  const unresolved = gated.filter((it) => !status[it.selector]).length;

  async function handleSubmit() {
    setError(null);
    setPhase('submitting');
    try {
      const approvals = {}; const skipped = [];
      for (const it of review) {
        if (it.section === 'file') continue;
        if (status[it.selector] === 'skipped') { skipped.push(it.selector); continue; }
        approvals[it.selector] = values[it.selector];
      }
      const r = await fetch('/api/submit/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, approvals, skipped }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Submission failed');
      setResult(d.result);
      setPhase('done');
    } catch (err) { setError(err.message); setPhase('review'); }
  }

  // ---------------------------------------------------------------- render
  if (phase === 'url') {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Step 3 — Paste a VC form</h1>
        <p className="mt-2 text-slate-600">
          We’ll read the form, draft every answer from your profile and report,
          and show you everything before anything is sent.
        </p>
        {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">⚠ {error}</p>}
        <form onSubmit={handleExtract} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold">VC form URL <span className="text-red-700">(required)</span></span>
            <input type="text" value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://… (or a local test form)"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Fund name <span className="font-normal text-slate-500">(optional)</span></span>
            <input type="text" value={form.fund_name} onChange={(e) => setForm((p) => ({ ...p, fund_name: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Fund focus <span className="font-normal text-slate-500">(optional — sharpens “why this fund”)</span></span>
            <input type="text" value={form.fund_focus} onChange={(e) => setForm((p) => ({ ...p, fund_focus: e.target.value }))}
              placeholder="e.g. Fintech, Seed"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <button type="submit" className="w-full rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800">
            Read the form & draft answers →
          </button>
        </form>
      </div>
    );
  }

  if (phase === 'extracting' || phase === 'submitting') {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-700" aria-hidden="true" />
        <h2 className="mt-6 text-xl font-bold">{phase === 'extracting' ? 'Reading the form and drafting answers…' : 'Filling and submitting…'}</h2>
        <p className="mt-2 text-sm text-slate-500">This can take a minute. Leave this page open.</p>
      </div>
    );
  }

  if (phase === 'duplicate') {
    const when = duplicate?.submitted_at ? new Date(duplicate.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const statusLabel = (duplicate?.status ?? 'submitted').replace(/_/g, ' ');
    return (
      <div className="mx-auto max-w-md py-16">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
          <h1 className="flex items-center gap-2 text-xl font-bold text-amber-900">
            <span aria-hidden="true">⚠</span> You’ve applied here before
          </h1>
          <p className="mt-3 text-amber-900">
            You already submitted to <strong>{duplicate?.vc_name || duplicate?.domain}</strong> on{' '}
            <strong>{when}</strong> — current status: <strong>{statusLabel}</strong>.
          </p>
          <p className="mt-2 text-sm text-amber-800">Submitting again will create a second application. Continue only if that’s what you want.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => runExtract(true)} className="rounded-xl bg-amber-700 px-5 py-2.5 font-semibold text-white hover:bg-amber-800">
              Continue anyway
            </button>
            <button onClick={() => { setPhase('url'); setDuplicate(null); }} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-semibold hover:bg-slate-100">
              Cancel
            </button>
            <a href="/submissions" className="self-center text-sm font-semibold text-amber-900 underline">View your submissions</a>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white" aria-hidden="true">✓</div>
        <h1 className="mt-5 text-2xl font-bold">{result?.submitted ? 'Submitted' : 'Filled (not submitted)'}</h1>
        <p className="mt-2 text-slate-600">
          {result?.fields_filled} fields filled, {result?.files_uploaded} deck uploaded
          {result?.fields_failed ? `, ${result.fields_failed} failed` : ''}
          {result?.skipped_count ? `, ${result.skipped_count} skipped` : ''}.
        </p>
        <p className="mt-1 text-xs text-slate-500">Logged as {result?.submission_id}.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={() => { setPhase('url'); setSession(null); setForm({ url: '', fund_name: '', fund_focus: '' }); setResult(null); }}
            className="rounded-xl bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800">Submit another</button>
          <a href="/submissions" className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-semibold hover:bg-slate-100">View submissions</a>
          <a href="/" className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-semibold hover:bg-slate-100">Back to home</a>
        </div>
      </div>
    );
  }

  // ---- review phase ----
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">Step 4 — Review before sending</h1>
      <p className="mt-2 text-slate-600">
        {session.field_count} fields found on <span className="font-mono text-sm">{session.domain || 'the form'}</span>.
        Confirm or edit the flagged answers below. <strong>Nothing is sent until you click submit.</strong>
      </p>
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">⚠ {error}</p>}

      {ORDER.map((kind) => {
        const items = review.filter((it) => it.section === kind);
        if (!items.length) return null;
        const meta = SECTIONS[kind];
        return (
          <section key={kind} className="mt-8">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              <Badge kind={kind} />
              <span>{meta.title} <span className="font-normal text-slate-500">({items.length})</span></span>
            </h2>
            <div className="mt-3 space-y-3">
              {items.map((it) => (
                <FieldRow key={it.selector} item={it} kind={kind} meta={meta}
                  value={values[it.selector]} status={status[it.selector]}
                  onChange={(v) => setVal(it.selector, v)} onApprove={() => approve(it.selector)} onSkip={() => skip(it.selector)} />
              ))}
            </div>
          </section>
        );
      })}

      <div className="sticky bottom-0 mt-10 border-t border-slate-200 bg-slate-50 py-4">
        <button onClick={handleSubmit} disabled={unresolved > 0}
          className="w-full rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
          {unresolved > 0
            ? `Resolve ${unresolved} flagged item${unresolved === 1 ? '' : 's'} above first`
            : 'Fill & submit the form'}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          The form is only submitted when you click. AI-drafted answers are never sent without your approval.
        </p>
      </div>
    </div>
  );
}

function FieldRow({ item, kind, meta, value, status, onChange, onApprove, onSkip }) {
  // File rows are informational — they show which deck will attach (or a prompt
  // to upload one), never an editable field.
  if (kind === 'file') {
    return (
      <div className={`rounded-xl border ${meta.border} bg-white p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{item.field_label}</span>
          <span className="text-xs font-medium text-slate-500">{item.key}</span>
        </div>
        <p className={`mt-1 text-sm ${item.asset_available ? 'text-slate-700' : 'text-amber-900'}`}>
          {item.asset_available ? `📎 ${item.value}` : `⚠ ${item.value}`}
        </p>
        {!item.asset_available && (
          <a href="/deck" className="mt-2 inline-block rounded-lg bg-blue-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-800">
            Upload a deck →
          </a>
        )}
      </div>
    );
  }

  // Auto-filled rows collapse; everything else stays open for inspection.
  const collapsible = kind === 'auto';
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{item.field_label}</span>
        <span className="text-xs font-medium text-slate-500">
          {item.key !== 'unknown' ? <span className="font-mono">{item.key}</span> : 'no match'} · {Math.round(item.confidence * 100)}%
        </span>
      </div>
      {item.flag && (
        <p className="mt-1 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900">⚠ {item.flag}</p>
      )}
      {kind === 'needs_approval' && item.confidence < 0.7 && item.rationale && (
        <p className="mt-1 text-xs italic text-slate-500">Why unsure: {item.rationale}</p>
      )}
      {item.field_type === 'select' ? (
        <select className="mt-2 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
          value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(item.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <textarea className="mt-2 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
          rows={Math.min(6, Math.max(2, Math.ceil((value || '').length / 90)))}
          placeholder={kind === 'manual' ? 'Type your answer, or skip…' : ''}
          value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {item.sources_used?.length > 0 && (
        <p className="mt-1 text-xs text-slate-400">Sources: {item.sources_used.join(', ')}</p>
      )}
      {meta.gate && (
        <div className="mt-2 flex items-center gap-2">
          {status === 'approved' && <span className="text-sm font-semibold text-emerald-800">✓ Approved</span>}
          {status === 'edited' && <span className="text-sm font-semibold text-slate-700">✎ Edited — will be sent</span>}
          {status === 'skipped' && <span className="text-sm font-semibold text-slate-500">⊘ Skipped — left blank</span>}
          {!status && (
            <>
              <button onClick={onApprove} className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">✓ Approve</button>
              <button onClick={onSkip} className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold hover:bg-slate-100">⊘ Skip</button>
            </>
          )}
          {status && status !== 'skipped' && (
            <button onClick={onSkip} className="text-xs text-slate-500 underline hover:text-slate-700">skip instead</button>
          )}
        </div>
      )}
    </>
  );

  const boxCls = `rounded-xl border ${meta.border} ${meta.bg ?? 'bg-white'} p-4`;
  if (collapsible) {
    return (
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3.5">
          <span className="font-semibold">{item.field_label}</span>
          <span className="max-w-md truncate text-sm text-slate-500">{value}</span>
        </summary>
        <div className="border-t border-slate-100 p-3.5">{body}</div>
      </details>
    );
  }
  return <div className={boxCls}>{body}</div>;
}
