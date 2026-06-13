'use client';
// Onboarding — Steps 1 & 2 of the five-step flow:
// upload assets → parse → review extracted profile → fill gaps → pick voice.
//
// Accessibility note: tier badges always combine an icon + text label.
// Color is reinforcement only, never the sole signal.
import { useEffect, useRef, useState } from 'react';

const FIELD_LABELS = {
  company_name: 'Company name',
  company_website: 'Company website',
  stage: 'Stage',
  sector_tags: 'Sector / industry tags',
  one_liner: 'One-line description',
  problem_statement: 'Problem you solve',
  solution_description: 'Your solution',
  competitive_landscape: 'Competitive landscape',
  target_customer: 'Target customer',
  go_to_market: 'Go-to-market',
  business_model: 'Business model',
  key_metrics: 'Key metrics',
  tam_description: 'Market size (TAM)',
  use_of_funds: 'Use of funds',
  raise_amount: 'Raise amount',
  raise_instrument: 'Raise instrument (SAFE, equity, note…)',
  preferred_name: 'Your name',
  email: 'Your email',
  linkedin_url: 'Your LinkedIn URL',
  founders: 'Founders',
  pitch_decks: 'Pitch deck',
  voice_preference: 'Voice',
};

const MANUAL_FIELDS = ['preferred_name', 'email', 'linkedin_url', 'company_website', 'sector_tags', 'raise_amount', 'raise_instrument', 'use_of_funds'];

const PARSE_MESSAGES = [
  'Reading your report…',
  'Extracting your company profile…',
  'Scoring confidence on every field…',
  'Synthesizing your Intelligence Record…',
  'Building your founder profile…',
];

function Badge({ kind }) {
  const styles = {
    auto: { icon: '✓', text: 'Filled automatically', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
    review: { icon: '?', text: 'Please confirm', cls: 'border-amber-400 bg-amber-50 text-amber-900' },
    manual: { icon: '✎', text: 'You fill this in', cls: 'border-slate-400 bg-slate-100 text-slate-800' },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles.cls}`}>
      <span aria-hidden="true">{styles.icon}</span> {styles.text}
    </span>
  );
}

export default function Onboarding() {
  const [phase, setPhase] = useState('loading'); // loading | upload | parsing | review | done
  const [files, setFiles] = useState({});
  const [parseMsg, setParseMsg] = useState(PARSE_MESSAGES[0]);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // /api/profile payload
  const [edits, setEdits] = useState({}); // key -> { value, source }
  const [approved, setApproved] = useState({}); // key -> true
  const [voice, setVoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const msgTimer = useRef(null);

  async function loadProfile() {
    const r = await fetch('/api/profile');
    const d = await r.json();
    setData(d);
    setVoice(d.profile.voice_preference?.value ?? null);
    // Review items resolved on a previous visit start out confirmed, so the
    // founder doesn't have to re-approve them and the submit gate stays open.
    if (d.resolved_review?.length) {
      setApproved((p) => {
        const next = { ...p };
        for (const k of d.resolved_review) next[k] = true;
        return next;
      });
    }
    return d;
  }

  useEffect(() => {
    (async () => {
      const d = await loadProfile();
      // Step 1 links here with ?step=upload to reach the upload screen even when
      // a profile already exists (to replace the report or add a deck). Step 2
      // (no param) jumps straight to review once a profile is built.
      const forceUpload = new URLSearchParams(window.location.search).get('step') === 'upload';
      setPhase(forceUpload || !d.hydration ? 'upload' : 'review');
    })().catch(() => setPhase('upload'));
  }, []);

  async function handleParse(e) {
    e.preventDefault();
    setError(null);
    const hasParse = !!data?.hydration;
    const newReport = files.greg_report;
    const deckFile = files.pitch_deck;
    const memo = files.investor_memo;
    const onePager = files.one_pager;

    // The report is required only the first time; after that it's on file and
    // re-uploading replaces it. A memo / one-pager are read together with the
    // report, so they need a report (re)parse to take effect.
    if (!newReport && !hasParse) {
      setError('Please choose your CEO Syndicate report PDF first.');
      return;
    }
    if (!newReport && (memo || onePager)) {
      setError('To add a memo or one-pager, re-upload your report too — they’re read together.');
      return;
    }
    if (!newReport && !deckFile) {
      // Nothing to upload — just continue to review.
      if (hasParse) setPhase('review');
      return;
    }

    const reparsing = !!newReport;
    setParseMsg(reparsing ? PARSE_MESSAGES[0] : 'Saving your pitch deck…');
    setPhase('parsing');
    if (reparsing) {
      let i = 0;
      msgTimer.current = setInterval(() => {
        i = (i + 1) % PARSE_MESSAGES.length;
        setParseMsg(PARSE_MESSAGES[i]);
      }, 12000);
    }
    try {
      // Deck goes to the deck library (supports multiple versions + default).
      if (deckFile) {
        const dfd = new FormData();
        dfd.append('deck', deckFile);
        dfd.append('label', deckFile.name.replace(/\.[^.]+$/, ''));
        const dr = await fetch('/api/deck', { method: 'POST', body: dfd });
        const dd = await dr.json();
        if (!dr.ok) throw new Error(dd.error ?? 'Deck upload failed');
      }
      // Report (+ memo / one-pager) re-runs the intelligence pipeline.
      if (newReport) {
        const fd = new FormData();
        fd.append('greg_report', newReport);
        if (memo) fd.append('investor_memo', memo);
        if (onePager) fd.append('one_pager', onePager);
        const r = await fetch('/api/parse', { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Parsing failed');
      }
      await loadProfile();
      setFiles({});
      setPhase('review');
    } catch (err) {
      setError(err.message);
      setPhase('upload');
    } finally {
      clearInterval(msgTimer.current);
    }
  }

  function currentValue(key) {
    if (key in edits) return edits[key].value;
    const v = data?.profile?.[key]?.value;
    return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  }

  function setEdit(key, value, source = 'manual') {
    setEdits((p) => ({ ...p, [key]: { value, source } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates = [];
      for (const [key, e] of Object.entries(edits)) {
        // founders is derived below from the single contact fields, not pushed raw
        if (key === 'founders') continue;
        if (e.value !== '' || data?.profile?.[key]) updates.push({ key, value: e.value, source: e.source });
      }
      for (const key of Object.keys(approved)) {
        if (!(key in edits)) updates.push({ key, value: data.profile[key]?.value ?? '', source: 'confirmed' });
      }
      if (voice) updates.push({ key: 'voice_preference', value: voice, source: 'manual' });

      // Single source of truth for contact info: Founder #1 is built from the
      // "About you" name/email/LinkedIn plus the title/bio entered below.
      const finalVal = (k) => (k in edits ? edits[k].value : (data?.profile?.[k]?.value ?? ''));
      const existingFounder = (Array.isArray(data?.profile?.founders?.value) ? data.profile.founders.value[0] : null) ?? {};
      const founderEdit = edits.founders?.value?.[0] ?? {};
      const founder0 = {
        name: finalVal('preferred_name'),
        title: founderEdit.title ?? existingFounder.title ?? '',
        email: finalVal('email'),
        linkedin: finalVal('linkedin_url'),
        bio: founderEdit.bio ?? existingFounder.bio ?? '',
      };
      updates.push({ key: 'founders', value: [founder0], source: 'manual' });
      const r = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!r.ok) throw new Error('Save failed');
      await loadProfile();
      setEdits({});
      setApproved({});
      setPhase('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------- render
  if (phase === 'loading') return <p className="text-slate-500">Loading…</p>;

  if (phase === 'upload') {
    const hasParse = !!data?.hydration;
    const fileRow = (type, label, { accept = 'application/pdf', hint = null } = {}) => (
      <label className="block rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">
            {label} <span className="text-sm font-normal text-slate-500">(optional)</span>
          </span>
          {files[type] && <span className="text-sm font-medium text-emerald-800">✓ {files[type].name}</span>}
        </div>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        <input
          type="file"
          accept={accept}
          className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-blue-800"
          onChange={(e) => { const f = e.target.files?.[0]; setFiles((p) => ({ ...p, [type]: f })); }}
        />
      </label>
    );

    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Step 1 — Your documents</h1>
        <p className="mt-2 text-slate-600">
          {hasParse
            ? 'Your report is already on file. Replace it to re-extract your profile, or add your pitch deck below.'
            : 'Your CEO Syndicate report is required. The others are optional but make your answers stronger.'}
        </p>
        {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">⚠ {error}</p>}
        <form onSubmit={handleParse} className="mt-6 space-y-4">
          {/* CEO Syndicate report */}
          <label className="block rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                CEO Syndicate report (Greg Report){' '}
                {hasParse
                  ? <span className="text-sm font-semibold text-emerald-800">✓ on file</span>
                  : <span className="text-sm font-semibold text-red-700">(required)</span>}
              </span>
              {files.greg_report && <span className="text-sm font-medium text-emerald-800">✓ {files.greg_report.name}</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {hasParse ? 'Choose a file only to replace it and rebuild your profile.' : 'Your profile is built from this report.'}
            </p>
            <input
              type="file"
              accept="application/pdf"
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-blue-800"
              onChange={(e) => { const f = e.target.files?.[0]; setFiles((p) => ({ ...p, greg_report: f })); }}
            />
          </label>

          {/* Pitch deck → deck library */}
          {fileRow('pitch_deck', 'Pitch deck', { accept: '.pdf,.ppt,.pptx', hint: 'Attached to VC forms. Saved to your deck library — you can keep more than one on the Decks page.' })}

          {/* Read together with the report on a (re)parse */}
          {fileRow('investor_memo', 'Investor memo', { hint: 'Read together with your report when (re)building your profile.' })}
          {fileRow('one_pager', 'One-pager', { hint: 'Read together with your report when (re)building your profile.' })}

          <button type="submit" className="w-full rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800">
            {hasParse ? 'Save changes →' : 'Build my profile →'}
          </button>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>PDFs (deck also PPT/PPTX). Rebuilding the profile takes 2–3 minutes.</span>
            {hasParse && (
              <button type="button" onClick={() => setPhase('review')} className="font-semibold text-blue-700 hover:underline">
                Skip to review →
              </button>
            )}
          </div>
          <a href="/deck" className="block text-center text-xs font-semibold text-blue-700 hover:underline">📎 Manage your pitch decks</a>
        </form>
      </div>
    );
  }

  if (phase === 'parsing') {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-700" aria-hidden="true" />
        <h2 className="mt-6 text-xl font-bold">{parseMsg}</h2>
        <p className="mt-2 text-sm text-slate-500">
          This takes 2–3 minutes. Leave this page open.
        </p>
      </div>
    );
  }

  if (phase === 'done') {
    const stillMissing = data?.missing?.filter((m) => m.field !== 'pitch_decks') ?? [];
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white" aria-hidden="true">✓</div>
        <h1 className="mt-5 text-2xl font-bold">Profile saved</h1>
        {stillMissing.length > 0 ? (
          <p className="mt-2 text-slate-600">
            Still missing: {stillMissing.map((m) => FIELD_LABELS[m.field] ?? m.field).join(', ')}.
            You can come back anytime.
          </p>
        ) : (
          <p className="mt-2 text-slate-600">Your profile is complete and ready to power VC applications.</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <a href="/" className="rounded-xl bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800">Back to home</a>
          <button onClick={() => setPhase('review')} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 font-semibold hover:bg-slate-100">
            Keep editing
          </button>
        </div>
      </div>
    );
  }

  // ---- review phase ----
  const hydration = data?.hydration ?? { auto: [], review: [], blank: [] };
  const profile = data?.profile ?? {};
  const reviewKeys = hydration.review.map((e) => e.profileKey);
  const autoEntries = hydration.auto.filter((e) => e.profileKey !== 'founders');
  const founder = (Array.isArray(profile.founders?.value) ? profile.founders.value[0] : null) ?? { name: '', title: '', email: '', linkedin: '', bio: '' };
  const manualKeys = MANUAL_FIELDS.filter((k) => !reviewKeys.includes(k));
  const unresolved = hydration.review.filter((e) => !approved[e.profileKey] && !(e.profileKey in edits)).length;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">Step 2 — Review your profile</h1>
      <p className="mt-2 text-slate-600">
        Everything below was read from your documents. Confirm the flagged items,
        fill in your details, and choose how your answers should sound.
      </p>
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">⚠ {error}</p>}

      {/* Section: needs confirmation */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Badge kind="review" />
          <span>{hydration.review.length} item{hydration.review.length === 1 ? '' : 's'} the AI wasn&apos;t sure about</span>
        </h2>
        <div className="mt-3 space-y-3">
          {hydration.review.map((e) => (
            <div key={e.profileKey} className="rounded-xl border border-amber-300 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{FIELD_LABELS[e.profileKey] ?? e.profileKey}</span>
                <span className="text-xs font-medium text-slate-500">{Math.round(e.confidence * 100)}% confident</span>
              </div>
              {e.confidence < 0.7 && e.rationale && (
                <p className="mt-1 text-xs italic text-slate-500">Why unsure: {e.rationale}</p>
              )}
              <textarea
                className="mt-2 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                rows={Math.min(5, Math.max(2, Math.ceil(currentValue(e.profileKey).length / 90)))}
                value={currentValue(e.profileKey)}
                onChange={(ev) => setEdit(e.profileKey, ev.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                {approved[e.profileKey] && !(e.profileKey in edits) ? (
                  <span className="text-sm font-semibold text-emerald-800">✓ Confirmed</span>
                ) : e.profileKey in edits ? (
                  <span className="text-sm font-semibold text-slate-700">✎ Edited — will be saved</span>
                ) : (
                  <button
                    onClick={() => setApproved((p) => ({ ...p, [e.profileKey]: true }))}
                    className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    ✓ Looks right
                  </button>
                )}
              </div>
            </div>
          ))}
          {hydration.review.length === 0 && <p className="text-sm text-slate-500">Nothing to confirm — the AI was confident about everything it filled in.</p>}
        </div>
      </section>

      {/* Section: auto-filled */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Badge kind="auto" />
          <span>{autoEntries.length} items filled from your report</span>
        </h2>
        <p className="mt-1 text-sm text-slate-500">The AI was highly confident about these. Click any to edit.</p>
        <div className="mt-3 space-y-2">
          {autoEntries.map((e) => (
            <details key={e.profileKey} className="rounded-xl border border-slate-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between gap-3 p-3.5">
                <span className="font-semibold">{FIELD_LABELS[e.profileKey] ?? e.profileKey}</span>
                <span className="max-w-md truncate text-sm text-slate-500">{currentValue(e.profileKey)}</span>
              </summary>
              <div className="border-t border-slate-100 p-3.5">
                <textarea
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                  rows={3}
                  value={currentValue(e.profileKey)}
                  onChange={(ev) => setEdit(e.profileKey, ev.target.value)}
                />
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* Section: founder details */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Badge kind="manual" />
          <span>About you</span>
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {manualKeys.map((k) => (
            <label key={k} className="block">
              <span className="text-sm font-semibold">{FIELD_LABELS[k] ?? k}</span>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                value={currentValue(k)}
                onChange={(ev) => setEdit(k, ev.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-semibold">Your role &amp; bio</div>
          <p className="mt-1 text-xs text-slate-500">
            Your name, email, and LinkedIn above are used as your founder details — no need to re-enter them.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title</span>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                placeholder="e.g. Founder &amp; CEO"
                value={(edits.founders?.value?.[0]?.title) ?? founder.title ?? ''}
                onChange={(ev) => {
                  const updated = { ...founder, ...(edits.founders?.value?.[0] ?? {}), title: ev.target.value };
                  setEdit('founders', [updated], 'manual');
                }}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Short bio</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
              rows={2}
              value={(edits.founders?.value?.[0]?.bio) ?? founder.bio ?? ''}
              onChange={(ev) => {
                const updated = { ...founder, ...(edits.founders?.value?.[0] ?? {}), bio: ev.target.value };
                setEdit('founders', [updated], 'manual');
              }}
            />
          </label>
        </div>
      </section>

      {/* Section: voice calibration */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">How should your answers sound?</h2>
        <p className="mt-1 text-sm text-slate-500">
          Investors can spot generic AI writing instantly. Pick the style that sounds most like you — every answer will be written in this voice.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Voice preference">
          {Object.entries(data?.voices ?? {}).map(([key, v]) => (
            <button
              key={key}
              role="radio"
              aria-checked={voice === key}
              onClick={() => setVoice(key)}
              className={`rounded-xl border-2 p-4 text-left transition ${
                voice === key ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{v.label}</span>
                {voice === key && <span className="text-sm font-bold text-blue-800">✓ Selected</span>}
              </div>
              <p className="mt-1 text-sm text-slate-600">{v.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Save */}
      <div className="sticky bottom-0 mt-10 border-t border-slate-200 bg-slate-50 py-4">
        <button
          onClick={handleSave}
          disabled={saving || !voice || unresolved > 0}
          className="w-full rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {saving
            ? 'Saving…'
            : unresolved > 0
            ? `Confirm or edit ${unresolved} flagged item${unresolved === 1 ? '' : 's'} above first`
            : !voice
            ? 'Pick a voice style above first'
            : 'Save my profile'}
        </button>
      </div>
    </div>
  );
}
