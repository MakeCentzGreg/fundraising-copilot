'use client';
// Pitch-deck library — upload, label, tag, set default, and remove decks.
// The default deck (or the best tag match) is what the submit flow attaches.
//
// Accessibility: the default marker is icon + the word "Default", never color
// alone (Greg is colorblind).
import { useEffect, useRef, useState } from 'react';

function fmtSize(b) {
  if (b == null) return '';
  return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
}

export default function DeckManager() {
  const [decks, setDecks] = useState(null);
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  async function load() {
    const r = await fetch('/api/deck');
    const d = await r.json();
    setDecks(d.decks ?? []);
  }
  useEffect(() => { load().catch(() => setDecks([])); }, []);

  async function handleUpload(e) {
    e.preventDefault();
    setError(null);
    if (!file) { setError('Choose a deck file first.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('deck', file);
      fd.append('label', label);
      fd.append('tags', tags);
      fd.append('is_default', String((decks?.length ?? 0) === 0));
      const r = await fetch('/api/deck', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Upload failed');
      setLabel(''); setTags(''); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function makeDefault(id) {
    await fetch('/api/deck', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    await load();
  }
  async function remove(id) {
    await fetch('/api/deck', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    await load();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold">Your pitch decks</h1>
      <p className="mt-2 text-slate-600">
        Upload the deck you want attached to VC forms. You can keep more than one
        — tag them (e.g. <span className="font-mono text-sm">fintech, seed</span>)
        and the right one is chosen per fund. Your default is used when nothing
        matches.
      </p>
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">⚠ {error}</p>}

      {/* Current decks */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">On file {decks ? `(${decks.length})` : ''}</h2>
        {decks == null ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : decks.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
            No decks yet. Upload one below — it’ll be attached automatically when you submit a form.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {decks.map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {d.label}
                    {d.is_default && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-900">
                        <span aria-hidden="true">★</span> Default
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500">{d.version} · {fmtSize(d.size_bytes)} · {d.filename}</span>
                </div>
                {d.tags?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.tags.map((t) => (
                      <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{t}</span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  {!d.is_default && (
                    <button onClick={() => makeDefault(d.id)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-100">
                      ★ Make default
                    </button>
                  )}
                  <button onClick={() => remove(d.id)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-50">
                    ✕ Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Upload */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">Add a deck</h2>
        <form onSubmit={handleUpload} className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block">
            <span className="text-sm font-semibold">Deck file <span className="text-red-700">(PDF, PPT, or PPTX — max 25MB)</span></span>
            <input ref={fileInput} type="file" accept=".pdf,.ppt,.pptx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-blue-800" />
            {file && <span className="mt-1 block text-sm font-medium text-emerald-800">✓ {file.name} ({fmtSize(file.size)})</span>}
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Label <span className="font-normal text-slate-500">(optional)</span></span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. MakeCentz Seed Deck"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Tags <span className="font-normal text-slate-500">(optional, comma-separated)</span></span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
              placeholder="fintech, seed"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <button type="submit" disabled={busy || !file}
            className="w-full rounded-xl bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
            {busy ? 'Uploading…' : 'Upload deck'}
          </button>
        </form>
      </section>

      <div className="mt-8">
        <a href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Back to home</a>
      </div>
    </div>
  );
}
