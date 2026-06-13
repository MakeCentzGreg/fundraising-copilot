'use client';
// Home — the five-step pipeline with live status.
import { useEffect, useState } from 'react';

const STEPS = [
  { n: 1, title: 'Upload your report', desc: 'CEO Syndicate report, plus pitch deck or memo if you have them.', href: '/onboarding', key: 'upload' },
  { n: 2, title: 'Review your profile', desc: 'Check what the AI extracted, fill the gaps, pick your voice.', href: '/onboarding', key: 'profile' },
  { n: 3, title: 'Paste a VC form link', desc: 'The tool reads every question on the form.', href: '/submit', key: 'form' },
  { n: 4, title: 'Review the answers', desc: 'Approve, edit, or skip every answer before anything is sent.', href: '/submit', key: 'answers' },
  { n: 5, title: 'Fill the form', desc: 'Practice mode only — nothing is submitted to a real VC.', href: '/submit', key: 'submit' },
];

function profileReady(status) {
  if (!status?.report_uploaded || !status.voice_set) return false;
  const missing = status.missing_required.filter((m) => m.field !== 'pitch_decks');
  return missing.length + status.review_pending === 0;
}

export default function Home() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  function stepState(key) {
    if (!status) return { label: 'Loading…', done: false };
    switch (key) {
      case 'upload':
        return status.report_uploaded
          ? { label: 'Done — report parsed', done: true }
          : { label: 'Start here', done: false };
      case 'profile': {
        if (!status.report_uploaded) return { label: 'Waiting on step 1', done: false };
        // A pitch deck is collected at upload (step 1), not on the review
        // screen, so it doesn't gate profile completion here.
        const missing = status.missing_required.filter((m) => m.field !== 'pitch_decks');
        const open = missing.length + status.review_pending;
        return open === 0 && status.voice_set
          ? { label: 'Done — profile complete', done: true }
          : { label: `${open} item${open === 1 ? '' : 's'} to finish`, done: false };
      }
      case 'form': {
        return profileReady(status)
          ? { label: 'Ready — paste a form', done: false }
          : { label: 'Finish your profile first', done: false };
      }
      case 'answers':
        return { label: 'Part of step 3', done: false };
      case 'submit':
        return { label: 'Practice mode — never sent to real VCs', done: false };
      default:
        return { label: '', done: false };
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Apply to VCs 10x faster</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        Your CEO Syndicate report already contains the answers investors ask for.
        This tool turns it into completed VC application forms — and you approve
        every word before anything goes out.
      </p>

      <ol className="mt-10 space-y-4">
        {STEPS.map((s) => {
          const st = stepState(s.key);
          const needsProfile = ['form', 'answers', 'submit'].includes(s.key);
          const clickable = s.href && (s.key === 'upload' || (needsProfile ? profileReady(status) : status?.report_uploaded));
          return (
            <li key={s.n}>
              <a
                href={clickable ? s.href : undefined}
                className={`block rounded-xl border bg-white p-5 transition ${
                  clickable ? 'border-blue-300 shadow-sm hover:border-blue-500 hover:shadow' : 'border-slate-200 opacity-80'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                      st.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700'
                    }`}
                    aria-hidden="true"
                  >
                    {st.done ? '✓' : s.n}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.title}</div>
                    <div className="text-sm text-slate-600">{s.desc}</div>
                  </div>
                  <div className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                    st.done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-700'
                  }`}>
                    {st.done ? '✓ ' : ''}{st.label}
                  </div>
                </div>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
