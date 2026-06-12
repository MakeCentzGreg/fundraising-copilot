// Shared Claude client + JSON-call helper.
// All AI calls in the app go through callClaudeJSON so parsing and
// retry behavior is consistent everywhere.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = 'claude-sonnet-4-6';

// Next.js loads .env.local automatically; plain `node scripts/*.js` does not.
function loadEnvLocal() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

let client = null;
function getClient() {
  if (!client) {
    loadEnvLocal();
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is missing. Add it to copilot-app/.env.local');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Pull the first JSON object out of a model response, tolerating
// markdown fences or stray preamble despite the prompt forbidding them.
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function callClaudeJSON({ system, user, maxTokens = 4096 }) {
  const c = getClient();
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await c.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return extractJSON(text);
    } catch (err) {
      lastErr = err;
      // Retry on parse failures and transient API errors (overloaded, rate limit)
      const status = err?.status ?? 0;
      const retryable = err instanceof SyntaxError || err.message?.includes('No JSON') || status === 429 || status >= 500;
      if (!retryable || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw lastErr;
}
