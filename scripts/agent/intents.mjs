// The INTENT contract between the LLM planner and the fast executor.
// An intent is a small, validated macro-action. The planner emits one; the
// executor (agent_brain.mjs) applies it as overrides on top of reactive rules.
// Keep this the SINGLE source of truth for what the agent is allowed to decide.

/** @typedef {Object} Intent
 *  @property {'grind'|'rest'|'retreat'|'travel'|'engage'|'hold'} mode
 *  @property {{x:number,z:number}} [anchor]   // camp/home to hold or travel to
 *  @property {number} [radius]                // engage radius around anchor
 *  @property {number} [targetId]              // force this mob as the focus
 *  @property {number} [lvlCeil]               // don't engage mobs above leader.lv+this
 *  @property {number} [fleeHp]                // disengage below this hp fraction
 *  @property {number} [restHp]                // sit/recover below this hp fraction
 *  @property {boolean} [pull]                 // ok to start new pulls
 *  @property {string} [reason]                // one line, for the journal
 */

export const INTENT_MODES = ['grind', 'rest', 'retreat', 'travel', 'engage', 'hold'];

// Bounds keep an over-eager or hallucinating model from doing something unsafe.
const NUM = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

export function validateIntent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = INTENT_MODES.includes(raw.mode) ? raw.mode : 'grind';
  const out = { mode, reason: String(raw.reason ?? '').slice(0, 140) };
  if (raw.anchor && typeof raw.anchor.x === 'number' && typeof raw.anchor.z === 'number') {
    out.anchor = { x: NUM(raw.anchor.x, -200, 4000, 0), z: NUM(raw.anchor.z, -2000, 4000, 0) };
  }
  if (raw.radius !== undefined) out.radius = NUM(raw.radius, 5, 80, 30);
  if (raw.targetId !== undefined && Number.isInteger(raw.targetId)) out.targetId = raw.targetId;
  if (raw.lvlCeil !== undefined) out.lvlCeil = NUM(raw.lvlCeil, -4, 3, 1);
  if (raw.fleeHp !== undefined) out.fleeHp = NUM(raw.fleeHp, 0.1, 0.9, 0.35);
  if (raw.restHp !== undefined) out.restHp = NUM(raw.restHp, 0.2, 0.95, 0.6);
  if (raw.pull !== undefined) out.pull = !!raw.pull;

  // --- conversational extensions: speech + concrete actions ---
  // The planner may also speak and act. Everything here is whitelisted + clamped
  // so a hallucinating model can only do safe, in-vocabulary things.
  if (raw.say && typeof raw.say === 'object' && typeof raw.say.text === 'string' && raw.say.text.trim()) {
    const ch = ['whisper', 'say', 'yell', 'party'].includes(raw.say.channel) ? raw.say.channel : 'whisper';
    out.say = { channel: ch, text: String(raw.say.text).slice(0, 200) };
    if (raw.say.to !== undefined) out.say.to = String(raw.say.to).slice(0, 40);
  }
  if (Array.isArray(raw.do)) {
    const ALLOWED = new Set(['equip', 'use', 'accept_party', 'accept_trade', 'follow', 'come', 'stop', 'emote']);
    out.do = raw.do
      .filter((a) => a && typeof a === 'object' && ALLOWED.has(a.action))
      .slice(0, 4)
      .map((a) => {
        const o = { action: a.action };
        if (a.item !== undefined) o.item = String(a.item).slice(0, 64);
        if (a.who !== undefined) o.who = String(a.who).slice(0, 40);
        if (a.emote !== undefined) o.emote = String(a.emote).slice(0, 24);
        return o;
      });
  }
  return out;
}

// Map a validated intent onto the executor's tunable/override surface. Returns a
// `combat`-style override object the rule-based brain already understands, plus a
// few agent-only directives (anchor/targetId/mode) the agent_brain reads directly.
export function intentToOverrides(intent) {
  if (!intent) return {};
  const o = { __mode: intent.mode };
  if (intent.anchor) { o.goHome = intent.mode === 'hold' || intent.mode === 'grind'; o.home = intent.anchor; o.__anchor = intent.anchor; }
  if (intent.radius !== undefined) o.homeRadius = intent.radius;
  if (intent.lvlCeil !== undefined) o.lvlCeil = intent.lvlCeil;
  if (intent.fleeHp !== undefined) o.fleeHp = intent.fleeHp;
  if (intent.restHp !== undefined) o.restHp = intent.restHp;
  if (intent.targetId !== undefined) o.__forceTarget = intent.targetId;
  if (intent.pull === false) { o.pullGrind = 0; o.pullTravel = 0; } // stop initiating pulls
  if (intent.mode === 'retreat') { o.fleeHp = Math.max(o.fleeHp ?? 0, 0.95); o.pullGrind = 0; }
  if (intent.mode === 'rest') { o.restHp = 0.95; o.pullGrind = 0; }
  return o;
}

export const DEFAULT_INTENT = { mode: 'grind', reason: 'default reactive grind', pull: true };
