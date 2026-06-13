// Pipeline session store — keeps a live Playwright browser/pipeline open between
// the /api/submit/extract call (run) and the /api/submit/commit call
// (commitApprovals). In-memory and single-process, which is exactly the MVP's
// "single form, single session" scope (final spec section 3).
import { chromium } from 'playwright';
import { SubmissionPipeline } from './pipeline.js';
import { getProfileValues } from './founderProfile.js';
import { newId } from './db.js';

// Next's App Router bundles each route handler separately, so a plain
// module-level Map is NOT shared between /extract and /commit. Anchor it on
// globalThis so both routes (and the dev-server hot reloads) see one store.
const sessions = (globalThis.__copilotSessions ??= new Map());
const TTL_MS = 30 * 60 * 1000; // close abandoned sessions after 30 min

// Build the founder's file-asset library from their stored profile decks.
function loadAssets() {
  const decks = getProfileValues().pitch_decks;
  if (!Array.isArray(decks)) return [];
  return decks.map((d) => ({ key: 'pitch_deck', ...d }));
}

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.created > TTL_MS) { s.browser.close().catch(() => {}); sessions.delete(id); }
  }
}

export async function startSession(url, vcContext = {}) {
  sweep();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pipeline = new SubmissionPipeline(page, { assets: loadAssets(), vcContext });
    const out = await pipeline.run(url);
    const id = newId('sess');
    sessions.set(id, { pipeline, browser, created: Date.now() });
    return { id, ...out };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export async function commitSession(id, approvals, skipped) {
  const s = sessions.get(id);
  if (!s) throw new Error('Session expired — please re-extract the form.');
  try {
    return await s.pipeline.commitApprovals(approvals, skipped);
  } finally {
    await s.browser.close().catch(() => {});
    sessions.delete(id);
  }
}

export async function cancelSession(id) {
  const s = sessions.get(id);
  if (s) { await s.browser.close().catch(() => {}); sessions.delete(id); }
}
