// LLM planner: turn the game brief + a world snapshot into ONE validated intent.
// Runs OFF the hot path (async, on a cadence). Never calls bot.cmd. Network call
// is gated on AGENT_PLAN=1 + ANTHROPIC_API_KEY; otherwise returns null so the
// executor falls back to the previous/default intent. Safe to import with no keys.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { validateIntent, INTENT_MODES, DEFAULT_INTENT } from './intents.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INTENT_FILE = join(HERE, 'intent.live.json');
// Provider-agnostic. Default is OpenAI-compatible — works with DeepSeek, OpenRouter,
// Groq, Together, OpenAI, a LOCAL Ollama (free), or CLEO (a Hermes model on the
// muse-infinite VPS exposed as /chat/completions: just point AGENT_BASE_URL/MODEL/
// AGENT_API_KEY at her). The planner emits a tiny JSON intent every ~8s, so a
// cheap/small/local model is plenty; Anthropic is optional.
//   AGENT_PROVIDER = 'openai' (default) | 'anthropic' | 'codex'
//   AGENT_BASE_URL = https://api.deepseek.com/v1 | https://openrouter.ai/api/v1 | http://localhost:11434/v1 (ollama) | <cleo endpoint>
//   AGENT_MODEL    = deepseek-chat | meta-llama/llama-3.1-8b-instruct | qwen2.5 | claude-… | <cleo model>
//   AGENT_API_KEY  = provider key (omit for local Ollama)
//   AGENT_RESPONSE_FORMAT = '0' to NOT send response_format:json_object (some OpenAI-
//                  compatible servers, incl. Cleo's, reject it; parseIntent still
//                  brace-extracts the JSON, so plain text output works too)
// 'codex' drives the LOCAL Codex CLI (`codex exec`) with your ChatGPT-login
// subscription — NO api key, NO billable API. See callCodex.
//   AGENT_CODEX_BIN = codex (override path), AGENT_CODEX_MODEL = (optional model),
//   AGENT_CODEX_TIMEOUT_MS = 120000
const PROVIDER = process.env.AGENT_PROVIDER || 'openai';
const BASE_URL = (process.env.AGENT_BASE_URL || (PROVIDER === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1')).replace(/\/$/, '');
const MODEL = process.env.AGENT_MODEL || (PROVIDER === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'deepseek-chat');
const API_KEY = process.env.AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE_URL);
const WANT_JSON_MODE = process.env.AGENT_RESPONSE_FORMAT !== '0';
const CODEX_BIN = process.env.AGENT_CODEX_BIN || 'codex';
const CODEX_MODEL = process.env.AGENT_CODEX_MODEL || '';
const CODEX_TIMEOUT_MS = Number(process.env.AGENT_CODEX_TIMEOUT_MS || 120000);
const MODEL_LABEL = PROVIDER === 'codex' ? (CODEX_MODEL || 'codex') : MODEL;  // what actually answered (for the journal/intent file)

let BRIEF = '';
try { BRIEF = readFileSync(join(HERE, 'game_brief.md'), 'utf8'); } catch { BRIEF = '(game brief missing)'; }

// Optional SOUL / persona prepended to the system prompt — the agent's identity + voice
// (e.g. a "Sonzai" soul, mirroring ~/.hermes/SOUL.md). AGENT_SOUL (inline) or
// AGENT_SOUL_FILE (path, repo-relative or absolute). Empty = the plain strategist.
// It flavors the reasoning + the in-game "say" voice; the intent schema below still
// binds the OUTPUT, so a persona can never make the agent emit something unsafe.
let SOUL = process.env.AGENT_SOUL || '';
if (!SOUL && process.env.AGENT_SOUL_FILE) {
  const sf = process.env.AGENT_SOUL_FILE;
  try { SOUL = readFileSync(sf.startsWith('/') ? sf : join(process.cwd(), sf), 'utf8'); } catch {}
}

const SYSTEM = `${SOUL ? `${SOUL.trim()}\n\n` : ''}${BRIEF}

You are the strategist. Given the world snapshot, output EXACTLY ONE JSON object
(no prose, no markdown fence) matching this schema:
{ "mode": one of ${JSON.stringify(INTENT_MODES)},
  "anchor": {"x":int,"z":int}?, "radius": int?, "targetId": int?,
  "lvlCeil": int (-4..3)?, "fleeHp": float (0..1)?, "restHp": float (0..1)?,
  "pull": bool?, "reason": "one short line",
  "say": { "channel": "whisper"|"say"|"party", "to": "name (for whisper)", "text": "your reply" }?,
  "do": [ up to 4 of:
     {"action":"equip","item":"<id from inventory>"}, {"action":"use","item":"<id>"},
     {"action":"accept_party"}, {"action":"accept_trade"},
     {"action":"follow","who":"name"}, {"action":"come","who":"name"},
     {"action":"stop"}, {"action":"emote","emote":"wave"} ]? }
Prefer safety: retreat/rest when hp or mana is low or multiple hostiles are aggroed;
only push level when healthy and adds are clear. Keep engaging in-band mobs.

CONVERSATION & ACTIONS. The snapshot also has: inbox (recent chat/trade requests TO you),
inventory (items you hold, with ids), equipment (what you're wearing), nearbyPlayers, trade.
- If someone in inbox spoke to you, answer in "say" — relaxed, friendly, casual human voice
  (NOT a robotic announcer, no roleplay flourish). Whisper back a whisper; use "say"/"party"
  if they spoke there. Keep it to a sentence. If nobody addressed you, omit "say".
- Do EXACTLY what's asked via "do": "wear/equip the X" -> equip that item's id (it MUST be in
  inventory); "use/drink/eat the X" -> use. "come here"/"come to me" -> come with their name;
  "follow me" -> follow; "stop"/"stay"/"wait" -> stop. Party invite -> accept_party. To take an
  item someone hands you, accept_trade (the handshake finishes itself). Only reference item ids
  that appear in inventory — never invent one.
- When no one needs you, just keep grinding: pick mode "grind" and say nothing.`;

// Drive the LOCAL Codex CLI non-interactively with the ChatGPT-login subscription
// (no API key). The combined prompt goes on stdin; the model's FINAL message is
// captured via `-o <file>` (clean, without codex's run log). Runs read-only in a
// throwaway temp cwd so it never reads or writes the repo. ~15-30s/call, fine off
// the hot path — the executor flies the hunter on the last intent meanwhile.
function callCodex(userMsg) {
  return new Promise((resolve, reject) => {
    let dir, settled = false;
    try { dir = mkdtempSync(join(tmpdir(), 'woc-intent-')); } catch (e) { return reject(e); }
    const outFile = join(dir, 'msg.txt');
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); try { rmSync(dir, { recursive: true, force: true }); } catch {} fn(); };
    const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', dir, '-o', outFile];
    if (CODEX_MODEL) args.push('-m', CODEX_MODEL);
    const cp = spawn(CODEX_BIN, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { try { cp.kill('SIGKILL'); } catch {} finish(() => reject(new Error('codex exec timeout'))); }, CODEX_TIMEOUT_MS);
    cp.on('error', (e) => finish(() => reject(e)));
    cp.on('close', () => { let txt = ''; try { txt = readFileSync(outFile, 'utf8'); } catch {} finish(() => resolve(txt)); });
    try { cp.stdin.write(`${SYSTEM}\n\n${userMsg}`); cp.stdin.end(); } catch (e) { finish(() => reject(e)); }
  });
}

async function callModel(snapshot) {
  if (process.env.AGENT_PLAN !== '1') return null;     // planner off → pure reactive
  const userMsg = `World snapshot:\n${JSON.stringify(snapshot)}\n\nYour intent JSON:`;
  if (PROVIDER === 'codex') return await callCodex(userMsg);  // ChatGPT-login subscription, no API key
  if (!API_KEY && !LOCAL) return null;                 // no creds and not local → off
  if (PROVIDER === 'anthropic') {
    const res = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: userMsg }] }),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const d = await res.json();
    return (d.content ?? []).map((c) => c.text ?? '').join('');
  }
  // OpenAI-compatible: DeepSeek / OpenRouter / Groq / Together / OpenAI / Ollama
  const body = {
    model: MODEL, temperature: 0.3, max_tokens: 300,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
  };
  if (WANT_JSON_MODE) body.response_format = { type: 'json_object' };  // Cleo: set AGENT_RESPONSE_FORMAT=0 if her endpoint rejects it
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`model ${res.status}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? '';
}

function parseIntent(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/); // first JSON object
  if (!m) return null;
  try { return validateIntent(JSON.parse(m[0])); } catch { return null; }
}

/** Plan once. Returns a validated intent (or null on disabled/failure). Persists
 *  the latest good intent to intent.live.json so the executor + humans can read it. */
export async function plan(snapshot) {
  let intent = null;
  try { intent = parseIntent(await callModel(snapshot)); } catch { intent = null; }
  if (intent) {
    try { writeFileSync(INTENT_FILE, JSON.stringify({ ...intent, _at: Date.now(), _model: MODEL_LABEL }, null, 2)); } catch {}
  }
  return intent;
}

/** Read the last persisted intent (used by the executor on boot / between plans). */
export function lastIntent() {
  try { return validateIntent(JSON.parse(readFileSync(INTENT_FILE, 'utf8'))) ?? DEFAULT_INTENT; }
  catch { return DEFAULT_INTENT; }
}

export { INTENT_FILE };
