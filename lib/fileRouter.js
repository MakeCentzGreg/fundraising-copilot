// File Router — final spec section 10.3 (carries v1 4.4 + v2 5.4).
// Selects the right deck version from the founder's asset library and executes
// the browser upload via a strategy waterfall. First strategy that succeeds wins;
// if all fail, returns needs_manual so the founder uploads by hand.
import fs from 'node:fs';

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25MB — iGan's limit (spec 7.2 v1)

// Score deck versions by audience-tag match + recency; is_default overrides
// scoring unless VC context strongly suggests a better-tagged asset (spec 10.3).
export function selectAsset(key, assets, vcContext = {}) {
  const want = key === 'one_pager_file' ? 'one_pager' : 'pitch_deck';
  const candidates = (assets || []).filter((a) => (a.key ?? want) === want || matchesType(a, want));
  if (candidates.length === 0) return null;

  const ctxTags = [vcContext.sector, vcContext.stage].filter(Boolean).map((s) => s.toLowerCase());

  function score(a) {
    const tags = (a.tags || []).map((t) => t.toLowerCase());
    let s = 0;
    if (tags.some((t) => t === ctxTags[0])) s += 2;      // sector match
    if (tags.some((t) => t === ctxTags[1])) s += 1;      // stage match
    if (a.last_updated) s += Date.parse(a.last_updated) / 1e13; // recency tiebreaker
    return s;
  }

  const scored = [...candidates].sort((a, b) => score(b) - score(a));
  const best = scored[0];
  const defaultAsset = candidates.find((a) => a.is_default);
  // Use the default unless a different asset scores strictly higher on tags.
  if (defaultAsset && best !== defaultAsset && score(best) - score(defaultAsset) < 1) {
    return defaultAsset;
  }
  return best;
}

function matchesType(a, want) {
  const hay = `${a.label ?? ''} ${a.key ?? ''}`.toLowerCase();
  return want === 'one_pager' ? /one[\s-]?pager/.test(hay) : /deck|pitch/.test(hay);
}

export function validateAsset(asset, constraints = {}) {
  if (!asset) return { valid: false, reason: 'no asset selected' };
  if (!asset.path || !fs.existsSync(asset.path)) return { valid: false, reason: 'file not found on disk' };
  const max = constraints.max_bytes || DEFAULT_MAX_BYTES;
  const size = asset.size_bytes ?? fs.statSync(asset.path).size;
  if (size > max) return { valid: false, reason: `file ${(size / 1e6).toFixed(1)}MB exceeds limit ${(max / 1e6).toFixed(0)}MB` };
  if (constraints.accepted_types?.length) {
    const ext = asset.path.split('.').pop().toLowerCase();
    if (!constraints.accepted_types.map((t) => t.toLowerCase()).includes(ext)) {
      return { valid: false, reason: `type .${ext} not in accepted types ${constraints.accepted_types.join(', ')}` };
    }
  }
  return { valid: true };
}

// Upload strategy waterfall (spec 10.3). Each returns true on success.
const STRATEGIES = [
  async function native_input(page, selector, asset) {
    const input = selector ? await page.$(selector) : await page.$('input[type=file]');
    if (!input) return false;
    await input.setInputFiles(asset.path);
    return true;
  },
  async function typeform_upload(page, _selector, asset) {
    const input = await page.$('[data-qa="upload-input"]');
    if (!input) return false;
    await input.setInputFiles(asset.path);
    return true;
  },
  async function airtable_upload(page, _selector, asset) {
    const input = await page.$('.attachmentCellContainer input[type=file]');
    if (!input) return false;
    await input.setInputFiles(asset.path);
    return true;
  },
  async function shadow_dom(page, _selector, asset) {
    const input = await page.$('pierce/input[type=file]');
    if (!input) return false;
    await input.setInputFiles(asset.path);
    return true;
  },
];

export async function executeUpload(page, selector, asset, constraints = {}) {
  const check = validateAsset(asset, constraints);
  if (!check.valid) return { success: false, needs_manual: true, reason: check.reason };

  for (const strategy of STRATEGIES) {
    try {
      if (await strategy(page, selector, asset)) {
        return { success: true, strategy: strategy.name, asset: asset.label ?? asset.path };
      }
    } catch { /* try next strategy */ }
  }
  return { success: false, needs_manual: true, reason: 'no upload strategy matched' };
}

// Route every file field in the classified mapping to an asset and upload it.
export async function routeFiles(page, fileMappings, assets, vcContext = {}) {
  const results = [];
  for (const m of fileMappings) {
    if (m.needs_manual) {
      results.push({ field: m.field_label, success: false, needs_manual: true, reason: 'platform blocks programmatic upload' });
      continue;
    }
    const asset = selectAsset(m.key, assets, vcContext);
    if (!asset) {
      results.push({ field: m.field_label, success: false, needs_manual: true, reason: `no asset for ${m.key}` });
      continue;
    }
    const constraints = { accepted_types: m.accepted_types, max_bytes: m.max_bytes || undefined };
    const r = await executeUpload(page, m.selector, asset, constraints);
    results.push({ field: m.field_label, key: m.key, ...r });
  }
  return results;
}
