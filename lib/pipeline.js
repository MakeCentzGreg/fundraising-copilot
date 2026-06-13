// Submission Pipeline — final spec section 13 (5-step MVP orchestrator).
// Two-step API, mirroring the spec's run()/commitApprovals() split:
//   run(url)                      — extract + classify + plan + compose (expensive)
//   commitApprovals(approvals)    — fill, upload, submit, log (only after review)
// The split is the trust boundary: nothing is filled or submitted until the
// founder has approved every flagged, AI-composed, and manual field.
import { extractForm } from './domExtractor.js';
import { classifyForm, cacheMapping } from './classifier.js';
import { composeBatch } from './answerComposer.js';
import { planFill } from './valueResolver.js';
import { loadComposerContext } from './intelligenceContext.js';
import { selectAsset, executeUpload } from './fileRouter.js';
import { getProfile } from './founderProfile.js';
import { logSubmission } from './submissionLog.js';

// Format a stored value for display/fill. Founder arrays become readable text;
// other arrays/objects are JSON; strings pass through.
export function formatValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === 'object') {
      return value.map((o) => [o.name, o.title].filter(Boolean).join(' — ') + (o.bio ? `: ${o.bio}` : '')).join('\n');
    }
    return value.join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Map a stored value to the closest <option> on a dropdown (spec 7.2 edge case).
// Exact (case-insensitive) -> substring either direction -> most word overlap.
export function matchOption(value, options = []) {
  if (!value || !options.length) return null;
  const v = String(value).toLowerCase().trim();
  const lc = options.map((o) => ({ o, l: o.toLowerCase().trim() }));
  const exact = lc.find((x) => x.l === v);
  if (exact) return exact.o;
  const sub = lc.find((x) => x.l.includes(v) || v.includes(x.l));
  if (sub) return sub.o;
  const vWords = new Set(v.split(/\W+/).filter(Boolean));
  let best = null, bestScore = 0;
  for (const x of lc) {
    const score = x.l.split(/\W+/).filter((w) => vWords.has(w)).length;
    if (score > bestScore) { best = x.o; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

// Decide which review section a planned field belongs to (spec 11.1).
function sectionFor(item, profileSource) {
  if (item.action === 'file') return 'file';
  if (item.action === 'compose') return 'ai_composed';
  if (item.unknown) return 'manual';
  if (item.confidence < 0.9) return 'needs_approval';
  if (profileSource === 'ceo_syndicate') return 'report';
  return 'auto';
}

export class SubmissionPipeline {
  constructor(page, { assets = [], vcContext = {} } = {}) {
    this.page = page;
    this.assets = assets;
    this.vcContext = vcContext;
    this.state = null;
  }

  async run(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const extraction = await extractForm(this.page);
    const { mappings } = await classifyForm(extraction.fields, extraction.domain);

    // Carry field metadata (selector, options, file flag) onto each mapping so
    // the resolver and the fill/upload steps have what they need.
    const byLabel = new Map(extraction.fields.map((f) => [f.field_label, f]));
    const enriched = mappings.map((m) => {
      const f = byLabel.get(m.field_label) ?? {};
      return { ...m, selector: f.selector, options: f.options, required: f.required,
        is_file_field: f.is_file_field, accepted_types: f.accepted_types, field_type: m.field_type ?? f.field_type };
    });

    const plan = planFill(enriched);
    const profile = getProfile();
    const ctx = loadComposerContext();

    // Compose answers for every 'compose' field in one batch.
    const composeTargets = plan.filter((p) => p.action === 'compose');
    const composed = await composeBatch(composeTargets, ctx, this.vcContext);
    const composedBySelector = new Map(composeTargets.map((p, i) => [p.selector, composed[i]]));

    // Build the review items the founder sees.
    const review = plan.map((p) => {
      const profileSource = profile[p.key === 'unknown' ? '' : p.key]?.source ?? null;
      const section = sectionFor(p, profileSource);
      const composedAnswer = composedBySelector.get(p.selector);

      // For file fields, resolve the deck now so the founder sees what will
      // upload (or that nothing is on file).
      if (section === 'file') {
        const asset = selectAsset(p.key, this.assets, this.vcContext);
        return {
          field_label: p.field_label, selector: p.selector, field_type: p.field_type,
          options: p.options ?? [], required: !!p.required, key: p.key, section,
          confidence: 1, source: 'asset',
          value: asset ? `Will upload: ${asset.label}` : 'No deck on file — upload one in onboarding, or skip',
          asset_available: !!asset, asset_label: asset?.label ?? null,
          rationale: '', flag: asset ? null : 'No pitch deck saved to your profile.', sources_used: [],
        };
      }

      // Pre-map dropdown fills to a real option so the UI shows the right choice.
      let value = section === 'ai_composed' ? (composedAnswer?.answer ?? '') : formatValue(p.value);
      if (p.field_type === 'select' && value) value = matchOption(value, p.options) ?? '';

      return {
        field_label: p.field_label,
        selector: p.selector,
        field_type: p.field_type,
        options: p.options ?? [],
        required: !!p.required,
        key: p.key,
        section,
        confidence: section === 'ai_composed' ? composedAnswer?.confidence ?? 0 : p.confidence,
        source: section === 'ai_composed' ? 'ai_composed' : section === 'report' ? 'ceo_syndicate' : 'classified',
        value,
        rationale: p.reasoning ?? '',
        flag: composedAnswer?.flag ?? null,
        sources_used: composedAnswer?.sources_used ?? [],
      };
    });

    this.state = { extraction, plan, review, domain: extraction.domain, url };
    return {
      platform: extraction.platform,
      domain: extraction.domain,
      field_count: extraction.fields.length,
      review,
      needsReview: true,
    };
  }

  // approvals: { [selector]: finalValue } for every non-file field the founder
  // approved or edited. skipped: [selector] the founder chose to leave blank.
  async commitApprovals(approvals = {}, skipped = []) {
    if (!this.state) throw new Error('commitApprovals called before run()');
    const skip = new Set(skipped);
    const log = [];
    let filled = 0, failed = 0, filesUploaded = 0, filesFailed = 0;

    // Phase 3a — fill text fields.
    for (const item of this.state.review) {
      if (item.section === 'file' || skip.has(item.selector)) continue;
      const value = approvals[item.selector];
      if (value == null || value === '') continue;
      try {
        await this.fillField(item, value);
        filled++;
        // Cache confirmed classifier mapping (spec: founder correction -> cache).
        if (item.key && item.key !== 'unknown') {
          cacheMapping(this.state.domain, { field_label: item.field_label, field_type: item.field_type, section_header: '' }, item.key, 1.0, 'confirmed');
        }
        log.push({ field: item.field_label, action: 'filled' });
      } catch (err) {
        failed++;
        log.push({ field: item.field_label, action: 'fill_failed', error: err.message });
      }
    }

    // Phase 3b — upload deck(s).
    let deckLabel = null;
    for (const item of this.state.review) {
      if (item.section !== 'file' || skip.has(item.selector)) continue;
      const asset = selectAsset(item.key, this.assets, this.vcContext);
      if (!asset) { filesFailed++; log.push({ field: item.field_label, action: 'no_asset' }); continue; }
      const r = await executeUpload(this.page, item.selector, asset, { accepted_types: item.options?.length ? undefined : undefined });
      if (r.success) { filesUploaded++; deckLabel = asset.label; log.push({ field: item.field_label, action: 'uploaded', asset: asset.label }); }
      else { filesFailed++; log.push({ field: item.field_label, action: 'upload_failed', reason: r.reason }); }
    }

    // Phase 3c — submit (clicks the local form's submit button; never a real VC).
    let submitted = false;
    try {
      const btn = await this.page.$('button[type=submit], input[type=submit]');
      if (btn) { await btn.click({ noWaitAfter: true }).catch(() => {}); submitted = true; }
    } catch { submitted = false; }

    // Phase 4 — log.
    const aiComposed = this.state.review.filter((i) => i.section === 'ai_composed').length;
    const record = logSubmission({
      vc_url: this.state.url,
      domain: this.state.domain,
      vc_name: this.vcContext.fund_name ?? this.state.domain,
      deck_label: deckLabel,
      fields_filled: filled,
      fields_failed: failed,
      fields_skipped: skip.size,
      files_uploaded: filesUploaded,
      ai_composed_count: aiComposed,
      log,
    });

    return {
      success: submitted && failed === 0,
      submitted,
      submission_id: record.id,
      fields_filled: filled,
      fields_failed: failed,
      files_uploaded: filesUploaded,
      files_failed: filesFailed,
      skipped_count: skip.size,
      log,
    };
  }

  async fillField(item, value) {
    const sel = item.selector;
    if (!sel) throw new Error('no selector');
    if (item.field_type === 'select') {
      const opt = matchOption(value, item.options) ?? value;
      await this.page.selectOption(sel, { label: opt }, { timeout: 5000 }).catch(async () => {
        await this.page.selectOption(sel, opt, { timeout: 5000 });
      });
    } else {
      await this.page.fill(sel, String(value));
    }
  }
}
