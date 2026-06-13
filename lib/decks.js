// Pitch-deck library — manages the founder's pitch_decks[] asset list in the
// profile (final spec section 7.1, Assets group). Standalone CRUD so a deck can
// be added/replaced any time without re-running the intelligence pipeline. The
// form engine reads these via pipelineSession.loadAssets() and fileRouter scores
// them by tag + recency, honouring is_default.
import fs from 'node:fs';
import { getProfileValues, setField } from './founderProfile.js';
import { newId } from './db.js';

// Read the deck list, backfilling ids on any legacy entry (e.g. a deck added by
// the onboarding parse route before this manager existed).
export function listDecks() {
  const v = getProfileValues().pitch_decks;
  if (!Array.isArray(v)) return [];
  let changed = false;
  for (const d of v) { if (!d.id) { d.id = newId('deck'); changed = true; } }
  if (changed) save(v);
  return v;
}

function save(decks) {
  setField('pitch_decks', decks, 'manual', 1.0);
}

export function addDeck({ label, path, mime, size_bytes, tags = [], is_default = false }) {
  const decks = listDecks();
  const makeDefault = is_default || decks.length === 0; // first deck is always default
  if (makeDefault) for (const d of decks) d.is_default = false;
  const entry = {
    id: newId('deck'),
    label: label?.trim() || 'Pitch deck',
    path, mime, size_bytes,
    tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
    version: `v${decks.length + 1}`,
    last_updated: new Date().toISOString(),
    is_default: makeDefault,
  };
  decks.push(entry);
  save(decks);
  return entry;
}

export function removeDeck(id) {
  const decks = listDecks();
  const removed = decks.find((d) => d.id === id) ?? null;
  let next = decks.filter((d) => d.id !== id);
  // If the default was removed, promote the most recently updated remaining deck.
  if (removed?.is_default && next.length) {
    next = [...next].sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated));
    next[0].is_default = true;
  }
  save(next);
  // Best-effort cleanup of the stored file.
  if (removed?.path) { try { fs.unlinkSync(removed.path); } catch { /* already gone */ } }
  return removed;
}

export function setDefaultDeck(id) {
  const decks = listDecks();
  let found = null;
  for (const d of decks) { d.is_default = d.id === id; if (d.is_default) found = d; }
  save(decks);
  return found;
}
