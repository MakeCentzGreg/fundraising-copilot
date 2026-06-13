// DOM Extractor — final spec section 10.1 (carries v1 section 4.1).
// Detects the form platform, harvests every field, and returns a clean manifest
// for the classifier. The HTML strategy is the fully-built fallback; the
// platform-specific strategies (Typeform / Airtable / Google Forms) add the
// selectors and quirks each platform needs on top of the same harvesting logic.
//
// extractForm(page) -> { platform, url, domain, fields: ExtractedField[] }

function detectPlatform(url, hasSelector) {
  if (/typeform\.com/.test(url) || hasSelector.typeform) return 'typeform';
  if (/airtable\.com/.test(url) || hasSelector.airtable) return 'airtable';
  if (/docs\.google\.com\/forms/.test(url) || hasSelector.gforms) return 'gforms';
  return 'html';
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

export async function extractForm(page) {
  const url = page.url();

  // Probe for platform-specific markers in the live DOM.
  const hasSelector = await page.evaluate(() => ({
    typeform: !!document.querySelector('[data-qa="question"]'),
    airtable: !!document.querySelector('.airtableFormField'),
    gforms: !!document.querySelector('[data-params]'),
  }));

  const platform = detectPlatform(url, hasSelector);

  // Typeform renders one question at a time — force every question into the DOM
  // before harvesting (spec 10.1 CAUTION).
  if (platform === 'typeform') {
    await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(2000);
  }

  // Per-platform root + file-field selectors, all harvested by the same DOM walk.
  const config = {
    html: { fieldSelector: 'input, textarea, select', gformsFile: false },
    typeform: { fieldSelector: '[data-qa="question"] input, [data-qa="question"] textarea, [data-qa="question"] select', gformsFile: false },
    airtable: { fieldSelector: '.airtableFormField input, .airtableFormField textarea, .airtableFormField select', gformsFile: false },
    gforms: { fieldSelector: '[role="listitem"] input, [role="listitem"] textarea, [role="listitem"] select', gformsFile: true },
  }[platform];

  const fields = await page.evaluate(harvest, config);

  return { platform, url, domain: domainOf(url), fields };
}

// Runs IN the browser. Walks the form, resolves labels/sections, normalizes
// types, and builds a fill selector for each field. Must be self-contained —
// no closured Node references.
/* eslint-disable */
function harvest(config) {
  const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

  function resolveLabel(el) {
    // 1. label[for=id]
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return clean(lbl.textContent);
    }
    // 2. closest wrapping <label>
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.textContent);
    // 3. aria-label
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    // 4. aria-labelledby
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (clean(t)) return clean(t);
    }
    // 5. placeholder
    if (el.placeholder) return clean(el.placeholder);
    // 6. name (last resort)
    return clean(el.name || el.id || '');
  }

  function resolveSection(el) {
    let node = el;
    for (let depth = 0; depth < 5 && node; depth++) {
      node = node.parentElement;
      if (!node) break;
      const legend = node.querySelector(':scope > legend');
      if (legend && clean(legend.textContent)) return clean(legend.textContent);
      const cls = (node.className || '').toString().toLowerCase();
      if (cls.includes('section') || cls.includes('group-title')) {
        const h = node.querySelector('h1,h2,h3,h4');
        if (h) return clean(h.textContent);
      }
      // nearest preceding heading among siblings
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^H[1-4]$/.test(sib.tagName)) return clean(sib.textContent);
        sib = sib.previousElementSibling;
      }
    }
    return '';
  }

  function helpText(el) {
    const wrap = el.closest('label') || el.parentElement;
    const hint = wrap?.querySelector('.help, .description, [class*="help"], [class*="desc"]');
    if (hint && !hint.contains(el)) return clean(hint.textContent);
    if (el.getAttribute('aria-describedby')) {
      const d = document.getElementById(el.getAttribute('aria-describedby'));
      if (d) return clean(d.textContent);
    }
    return '';
  }

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function normalizeType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const t = (el.type || 'text').toLowerCase();
    if (t === 'file') return 'file';
    if (t === 'email') return 'email';
    if (t === 'url') return 'url';
    if (t === 'number') return 'number';
    if (t === 'tel') return 'text';
    return 'text';
  }

  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    return '';
  }

  // Only real, on-screen controls — skip hidden/zero-size decorative inputs.
  function isVisible(el) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (el.getClientRects().length === 0) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  }

  const els = Array.from(document.querySelectorAll(config.fieldSelector))
    .filter((el) => !SKIP.has((el.type || '').toLowerCase()))
    .filter(isVisible)
    // collapse radio/checkbox groups to one entry per name
    .filter((el, i, arr) => {
      const t = (el.type || '').toLowerCase();
      if (t !== 'radio' && t !== 'checkbox') return true;
      return arr.findIndex((o) => o.name === el.name) === i;
    });

  // Resolve labels, then drop controls with no answerable label — an icon/
  // decorative input whose only text is a symbol (e.g. a "Δ" toggle) is not a
  // real question. Require at least one letter or digit.
  const built = els
    .map((el) => ({ el, label: resolveLabel(el) }))
    .filter(({ label }) => /[a-z0-9]/i.test(label));

  const total = built.length;
  return built.map(({ el, label }, idx) => {
    const type = normalizeType(el);
    const isFile = type === 'file';
    const options = el.tagName.toLowerCase() === 'select'
      ? Array.from(el.options).map((o) => clean(o.textContent)).filter((v) => v && !/^select/i.test(v))
      : Array.from(document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`))
          .filter((r) => /radio|checkbox/.test(r.type)).map((r) => clean(r.value || r.id)).filter(Boolean);
    const accept = el.getAttribute('accept') || '';
    return {
      field_label: label,
      field_type: type,
      help_text: helpText(el),
      placeholder: el.placeholder || '',
      section_header: resolveSection(el),
      selector: selectorFor(el),
      options,
      required: !!el.required || el.getAttribute('aria-required') === 'true',
      accepted_types: accept ? accept.split(',').map((s) => s.trim().replace(/^\./, '')) : [],
      max_bytes: 0,
      position_in_form: idx + 1,
      total_fields: total,
      is_file_field: isFile,
      // Google Forms blocks programmatic file upload (spec 10.1)
      needs_manual: isFile && config.gformsFile ? true : false,
    };
  });
}
/* eslint-enable */
