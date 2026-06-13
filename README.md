# Fundraising Copilot

Turn a CEO Syndicate evaluation report into completed VC application forms — and approve every word before anything is sent.

Founders raising capital fill out the same 20–40 questions across hundreds of VC intake forms. This tool reads your evaluation report once, builds a structured intelligence layer, and uses it to draft, fill, and (on your approval) submit any VC form. The thesis it validates: **founders can complete VC applications 10x faster from their Syndicate report.**

> **Safety:** This is a local tool. It is built and tested against a *local copy* of a VC form and **never submits to a real VC**. Your API key and all parsed company data stay on your machine (see [Privacy](#privacy)).

---

## The five-step flow

1. **Upload intelligence assets** — your CEO Syndicate report (required), plus pitch deck / memo / one-pager (optional). A confidence-scored parser extracts your profile.
2. **Review your profile** — extracted fields are shown by confidence tier. You correct, fill gaps, and pick a writing voice.
3. **Paste a VC form URL** — the tool loads the page, detects the platform, and harvests every field.
4. **Review the answers** — a source-labeled diff view: auto-filled, pulled-from-report, AI-drafted (clearly marked), and manual. Nothing is sent without approval.
5. **Submit** — fields are filled, the right deck is attached, the form is submitted, and the submission is logged.

## How it works

```
Intelligence assets (PDF)
   └─ Asset Parser ............ confidence-scored field extraction + narrative sections
        └─ Intelligence Record  strategic synthesis (10 MVP fields)
             └─ Profile Hydrator three-tier routing: auto ≥0.90 / review 0.60–0.89 / blank <0.60
                  └─ Founder Profile  canonical store, source + confidence per field
                       └─ Form Engine
                            domExtractor → classifier → answerComposer → fileRouter
                                 └─ Review Screen  source-labeled, founder approves
                                      └─ Pipeline  fill, upload deck, submit, log
```

The **Answer Composer** is the core: for any question your profile doesn't directly answer, it composes a response from three context layers — your profile (facts), your Intelligence Record (strategy), and the raw report narrative — written in your calibrated voice, and always routed through founder review.

## Tech stack

- **Node.js 22.5+** (uses the built-in `node:sqlite` — no native build step)
- **Next.js 14** (App Router, JavaScript/ESM)
- **Anthropic Claude** (`claude-sonnet-4-6`) for extraction, classification, and composition
- **Playwright** (Chromium) for form extraction and fill
- **Tailwind CSS** for the UI
- **pdfjs-dist** for PDF text extraction

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Install the Chromium browser Playwright drives
npx playwright install chromium

# 3. Add your Anthropic API key
#    Create .env.local in this directory:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
```

## Running

```bash
npm run dev
```

Open the printed URL (e.g. http://localhost:3000), then:

1. **Upload your report** at `/onboarding` and complete your profile.
2. **Add a pitch deck** at `/deck` (PDF, PPT, or PPTX) so it can be attached to forms.
3. **Submit a form** at `/submit` — paste a form URL and review the drafted answers.

## Testing

The MVP is defined by 8 acceptance tests. Each script prints PASS/FAIL and exits non-zero on failure.

```bash
node scripts/testParse.js [path-to-report.pdf]   # AT1–3: parse → Intelligence Record → hydration
node scripts/testCompose.js                       # AT6:   10 VC question types → composed answers
node scripts/testFormEngine.js                    # AT5–6: extract local form → classify → compose
node scripts/testPipeline.js                      # AT7–8: full 5-step flow → fill, upload, submit, log
```

`testFormEngine` and `testPipeline` run against `test/fixtures/igan-form.html` — a local copy of a VC intake form, so no real form is ever touched.

## Project structure

```
app/
  onboarding/page.js     Steps 1–2: upload + profile review
  deck/page.js           Pitch-deck library (upload / tag / default / remove)
  submit/page.js         Steps 3–5: paste form, review, submit
  api/
    parse/               Upload + parse → Intelligence Record + hydration
    profile/             Read/write the founder profile
    deck/                Deck CRUD
    submit/extract/      Run extraction + classification + composition
    submit/commit/       Fill, upload, submit, log
lib/
  assetParser.js         PDF parse + confidence-scored field extraction
  intelligenceRecord.js  10-field strategic synthesis
  profileHydrator.js     Three-tier confidence routing
  founderProfile.js      Canonical profile store + voice options
  domExtractor.js        Playwright field harvesting (Typeform/Airtable/GForms/HTML)
  classifier.js          Field → data-model key mapping
  answerComposer.js      Three-layer-context answer drafting + voice
  valueResolver.js       Fill / compose / file routing per field
  fileRouter.js          Deck selection + upload waterfall
  pipeline.js            5-step orchestrator (run / commitApprovals)
  decks.js               Pitch-deck library
scripts/                 Acceptance-test runners
test/fixtures/           Local VC form copy + sample deck
```

## Privacy

`.gitignore` excludes everything sensitive — it is **not** in this repo and never leaves your machine:

- `.env.local` — your Anthropic API key
- `data/` — the SQLite database, uploaded files, and all parsed report content

## Status & roadmap

**MVP complete** — all 8 acceptance tests pass; the full five-step flow works end to end.

Post-MVP (deferred until the 10x claim is validated with real submissions):

- **Investor CRM** — submission history, per-VC status, duplicate-submission guard
- **Founder Memory** — manual edits compound answer accuracy over time
- **Bulk queue** — submit to many forms in one review pass
- **VC research layer** — auto-populate "why this fund"
- Full 20-field Intelligence Record, report versioning, deck performance analytics
