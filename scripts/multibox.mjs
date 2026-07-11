// multibox.mjs — headless multibox: a coordinated party of up to 5 characters
// (one node process, one WebSocket each) that grinds toward the Hollow Crypt and
// writes its own story to disk. NO in-game chat — everything is journaled locally:
//   logs/party.md         party-wide coordination + milestones + 15s status
//   logs/<character>.md    each bot's first-person journal, driven by real events
//
// A "leader" picks targets and roams; the others follow tightly, assist its target
// with class rotations, and the healer keeps the party up. When the whole party
// reaches DUNGEON_LEVEL it marches to the crypt door (80,90) and zones in.
//
// IMPORTANT (live realms): every boxed character must be LOGGED OUT of the browser
// first, and multiboxing a public realm affects real players and is bannable.
//
// Usage:  node scripts/multibox.mjs <config.json>      (see multibox.config.example.json)

import WebSocket from 'ws';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadConfig } from './multibox_config.mjs';
import { relayInbound, makeOutboxPump } from './multibox_chat.mjs';

// Load .env (bot account passwords via passEnv) if present — secrets stay out of the JSON configs.
try { process.loadEnvFile(); } catch {}

// Pre-fetched bearer tokens captured by scripts/browser_auth.mjs (Turnstile-aware browser
// login): a flat { "<user>": "<token>" } map. Auto-read so any launch skips the Node
// /api/login (which the Cloudflare Turnstile gate now blocks) without needing *_TOKEN envs.
let TOKENS_FILE = {};
try { if (existsSync('multibox.tokens.json')) TOKENS_FILE = JSON.parse(readFileSync('multibox.tokens.json', 'utf8')); } catch {}

const cfgPath = process.argv[2] ?? process.env.MULTIBOX_CONFIG;
if (!cfgPath) { console.error('usage: node scripts/multibox.mjs <config.json>'); process.exit(1); }

const cfg = loadConfig(cfgPath);
const BASE = cfg.server ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const RUN_SECONDS = Number(cfg.runSeconds ?? 1800);
// Pluggable decision brain: cfg.brainPath / BRAIN_PATH (repo-relative) overrides the
// default rule-based brain — e.g. scripts/agent/agent_brain.mjs (agentic executor).
const BRAIN_PATH = process.env.BRAIN_PATH || cfg.brainPath || null;
const BRAIN_URL = BRAIN_PATH ? new URL(BRAIN_PATH, 'file://' + process.cwd() + '/') : new URL('./multibox_brain.mjs', import.meta.url);
const LEADER_NAME = (cfg.leader ?? cfg.bots?.[0]?.character ?? '').toLowerCase();
const DUNGEON_LEVEL = Number(cfg.dungeonLevel ?? cfg.combat?.dungeonLevel ?? 8); // march to the dungeon once the WHOLE party hits this
// Which dungeon to seek. Config-driven so a party can target Gravewyrm Sanctum (door (0,880),
// id 'gravewyrm_sanctum') instead of the default Hollow Crypt — see multibox.gravewyrm.json.
const DUNGEON = {
  id: cfg.dungeon?.id ?? 'hollow_crypt',
  name: cfg.dungeon?.name ?? 'the Hollow Crypt',
  door: cfg.dungeon?.door ?? { x: 80, z: 90 },
};
const CRYPT_DOOR = DUNGEON.door;

const LOG_DIR = 'logs';
mkdirSync(LOG_DIR, { recursive: true });

// single-instance lock per config: launching the SAME config twice puts two processes
// in the world fighting over the same characters (the duplicate-process flapping bug —
// one logs a char out while the other keeps it, parties split). Refuse the second launch.
const lockPath = `${LOG_DIR}/.${cfgPath.split('/').pop()}.lock`;
if (existsSync(lockPath)) {
  const pid = Number(readFileSync(lockPath, 'utf8').trim());
  let alive = false; try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
  if (alive) { console.error(`refusing to start: another multibox already runs this config (pid ${pid}). Stop it first: pkill -f ${cfgPath.split('/').pop()}`); process.exit(1); }
}
writeFileSync(lockPath, String(process.pid));
process.on('exit', () => { try { unlinkSync(lockPath); } catch {} });

// GLOBAL KILL SWITCH: `touch multibox.stop` (repo root, or set MULTIBOX_STOPFILE) and EVERY
// multibox process logs its party out and exits within a tick — and any RELAUNCH self-exits
// immediately while the flag exists. So `turn off` really stays off regardless of who relaunches
// it (e.g. a lingering background task). Remove the file to allow running again.
const STOP_FILE = process.env.MULTIBOX_STOPFILE ?? 'multibox.stop';
if (existsSync(STOP_FILE)) {
  console.error(`${STOP_FILE} present — refusing to start (remove it to allow). Exiting.`);
  process.exit(0); // the exit handler above releases the lock
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);
// CONSOLIDATED party log: every party writes to the one shared party.md so the dashboard's
// single "party" tab shows all parties together (each line carries the party's PTAG emoji, so
// 🟦A / 🟥B stay visually separable when they interleave). Set a per-config "partyLog" to a
// filename to break a party back out into its own tab (e.g. "party.duo.md").
const SLUG = (cfgPath.split('/').pop() || 'party').replace(/^multibox\./, '').replace(/\.json$/, '');
const partyPath = `${LOG_DIR}/${cfg.partyLog ?? 'party.md'}`;
// optional per-run party tag (e.g. an emoji) so two parties sharing party.md are
// visually separable at a glance. Prefixed onto every line THIS run writes.
const PTAG = cfg.tag ? `${cfg.tag} ` : '';
const partyLog = (line) => appendFileSync(partyPath, `- \`${stamp()}\` ${PTAG}${line}\n`);

function passwordFor(user) {
  const a = cfg.accounts?.[user];
  if (typeof a === 'string') return a;
  if (a?.passEnv) return process.env[a.passEnv] ?? '';
  if (a?.pass) return a.pass;
  throw new Error(`no password configured for account "${user}"`);
}
async function api(path, body, token, method = 'POST') {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', 'Origin': BASE, 'User-Agent': 'Mozilla/5.0', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- delta-snapshot reconstruction (mirrors server wire format) ---
const DELTA_SELF_KEYS = ['inv', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'weapon', 'party', 'trade', 'duel', 'auras', 'lroll'];
const mergeSelf = (prev, next) => { if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k]; return next; };
const ID_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents ?? []) { const p = prevEnts.get(w.id); if (p && w.k === undefined) for (const key of ID_KEYS) if (key in p) w[key] = p[key]; next.set(w.id, w); }
  for (const id of snap.keep ?? []) { const p = prevEnts.get(id); if (p) next.set(id, p); }
  return next;
}

// --- per-class combat + persona ---
const MELEE = new Set(['warrior', 'paladin', 'rogue', 'shaman']);
const HEAL_SPELL = { priest: 'lesser_heal', paladin: 'holy_light', druid: 'healing_touch', shaman: 'healing_wave' };
const OPENING_BUFF = { hunter: 'aspect_of_the_hawk', paladin: 'seal_of_righteousness', priest: 'power_word_fortitude', mage: 'frost_armor', warrior: 'battle_shout', warlock: 'demon_skin', druid: 'mark_of_the_wild', shaman: 'lightning_shield', rogue: null };
const PERSONA = {
  hunter:  { voice: 'the steady ranger', ding: ['Another notch on the bow.', 'Stronger. My aim sharpens.', 'The wilds teach well.'], kill: ['Clean shot, clean kill.', 'It never closed the distance.', 'Down before it reached me.'] },
  priest:  { voice: 'the weary healer',  ding: ['The Light grows in me.', 'I can mend deeper wounds now.', 'Faith rewarded with strength.'], kill: ['May it find rest.', 'Smitten, and sent on.', 'Even I must strike sometimes.'] },
  warrior: { voice: 'the brash tank',    ding: ['HAH! Bigger, stronger, louder.', 'More blood, more muscle.', 'Come at me now.'], kill: ['CRUSHED.', 'Stay down.', 'Next.'] },
  mage:    { voice: 'the haughty mage',  ding: ['My arcane mastery deepens.', 'As expected. Power accrues.', 'The weave bends further for me.'], kill: ['Reduced to ash.', 'Trivial.', 'Was that meant to threaten me?'] },
  warlock: { voice: 'the grim warlock',  ding: ['The shadows feed me well.', 'My pacts deepen.', 'Power, at the usual price.'], kill: ['Its soul was... useful.', 'Consumed.', 'A small darkness, repaid.'] },
  shaman:  { voice: 'the elemental hybrid', ding: ['The elements answer louder now.', 'Earth, fire, water — all in balance.', 'The ancestors lend me strength.'], kill: ['The storm takes you.', 'Returned to the elements.', 'Lightning finds its mark.'] },
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class Bot {
  constructor(spec) { this.user = spec.user; this.charName = spec.character; this.pid = -1; this.self = null; this.ents = new Map(); this.events = []; this.dotTarget = null; this.prevLevel = 1; this.wasLow = false; this.wasDead = false; this.kills = 0; this.connected = false; this.shuttingDown = false; }
  jpath() { return `${LOG_DIR}/${this.charName}.md`; }
  journal(line) { appendFileSync(this.jpath(), `- \`${stamp()}\` ${line}\n`); }

  connect(token, charId, cls, level) {
    this.token = token; this.charId = charId; this.cls = cls; this.prevLevel = level; this.shuttingDown = false;
    return this._open();
  }
  // open the socket; auto-reconnects on drop so a network/server hiccup doesn't
  // silently bench a bot for the rest of the run
  _open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`${this.charName}: connect timeout`)); } }, 12000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })));
      this.ws.on('message', (data) => {
        let m; try { m = JSON.parse(String(data)); } catch { return; }
        if (m.t === 'hello') { this.pid = m.pid; this.connected = true; this.needsReparty = true; if (!settled) { settled = true; clearTimeout(to); resolve(); } }
        else if (m.t === 'error') { if (!settled) { settled = true; clearTimeout(to); reject(new Error(`${this.charName}: ${m.error ?? 'auth rejected'}`)); } }
        else if (m.t === 'snap') { this.self = mergeSelf(this.self, m.self); this.ents = mergeEnts(this.ents, m); if (this.self) this.ents.set(this.self.id, this.self); }
        else if (m.t === 'events') this.events.push(...m.list);
      });
      this.ws.on('close', () => {
        this.connected = false;
        if (!this.shuttingDown) { const delay = 2000 + Math.floor(Math.random() * 3000); try { this.journal(`🔌 connection dropped — reconnecting in ${(delay / 1000).toFixed(1)}s…`); } catch {} setTimeout(() => { this._open().catch(() => {}); }, delay); } // jittered so a server hiccup doesn't reconnect all bots in lockstep
      });
      this.ws.on('error', () => { if (!settled) { settled = true; clearTimeout(to); reject(new Error(`${this.charName}: ws error`)); } });
    });
  }
  cmd(p) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'cmd', ...p })); }
  input(mi, facing) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) })); }
  pos() { return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 }; }
  dist(o) { const p = this.pos(); return Math.hypot((o.x ?? 0) - p.x, (o.z ?? 0) - p.z); }
  faceTo(o) { const p = this.pos(); return Math.atan2((o.x ?? 0) - p.x, (o.z ?? 0) - p.z); }
  offGcd() { return (this.self?.gcd ?? 0) <= 0 && !this.self?.cast; }
  hpFrac() { return (this.self?.hp ?? 0) / Math.max(1, this.self?.mhp ?? 1); }
  hostiles() { return [...this.ents.values()].filter((e) => e.k === 'mob' && !e.dead && e.h); }
  isHealer() { return !!HEAL_SPELL[this.cls]; }
}

// turn this bot's raw event stream into journal entries (real server events only)
const _loggedWins = new Map(); // text -> last-logged ms, to dedupe broadcast roll-resolution lines
function narrate(bot, leaderPid, lootQueue) {
  for (const ev of bot.events) {
    if (ev.pid !== undefined && ev.pid !== bot.pid) continue; // only this bot's own events
    if (ev.type === 'loot') {
      bot.journal(`💰 ${ev.text}`);
      // GEAR + ROLL OUTCOMES go to the PARTY TAB (party.md), so the loot/roll history is visible
      // there. Skip pure-currency pickups ("You loot 41c.") — those would flood the party log.
      const t = String(ev.text ?? '');
      if (/\bwins\b/i.test(t)) {
        // a roll RESOLUTION is BROADCAST to every party member, so narrate() (run once per bot) would log
        // it ~5x, and it can linger across ticks. Dedupe by exact text within a short window: log once.
        const nowMs = Date.now();
        if (!_loggedWins.has(t) || nowMs - _loggedWins.get(t) > 8000) { partyLog(`🎲 ${t}`); _loggedWins.set(t, nowMs); } // "<name> wins <Item> (roll)"
        if (_loggedWins.size > 200) for (const [k, ts] of _loggedWins) if (nowMs - ts > 30000) _loggedWins.delete(k);
      }
      else if (/receive:|loot\s+[^\d]/i.test(t)) partyLog(`💎 **${bot.charName}** looted: ${t.replace(/^You (receive:|loot)\s*/i, '').replace(/\.$/, '')}`);
    }
    else if (ev.type === 'respawn') bot.journal('☠️→✨ Resurrected at the graveyard and ran back to the body.');
  }
  // level-up: detect from self.lv (robust) and add persona flavor
  const lv = bot.self?.lv ?? bot.prevLevel;
  if (lv > bot.prevLevel) {
    const p = PERSONA[bot.cls] ?? { ding: ['Stronger.'] };
    bot.journal(`⬆️ **Reached level ${lv}.** ${pick(p.ding)}`);
    partyLog(`**${bot.charName}** dinged **${lv}**.`);
    bot.prevLevel = lv;
  }
  // mob kills near this bot (death events for hostiles it was fighting)
  for (const ev of bot.events) {
    if (ev.type === 'death') {
      const ent = bot.ents.get(ev.entityId);
      if (ent?.k === 'mob') {
        if (lootQueue && ent.x !== undefined) lootQueue.set(ev.entityId, { x: ent.x, z: ent.z, tries: 0 }); // queue corpse for looting
        if (bot.self?.target === ev.entityId) {
          const p = PERSONA[bot.cls] ?? { kill: ['Slain.'] };
          bot.kills++;
          bot.journal(`⚔️ Killed **${ent.nm ?? 'a foe'}**. ${pick(p.kill)}`);
        }
      }
    }
  }
  // near-death + recovery (once per dip)
  if (!bot.self?.dead) {
    const low = bot.hpFrac() < 0.25;
    if (low && !bot.wasLow) bot.journal(`🩸 Down to ${bot.self.hp} HP — bracing.`);
    if (!low && bot.wasLow) bot.journal(`💚 Patched up (${bot.self.hp}/${bot.self.mhp}).`);
    bot.wasLow = low;
  }
  // death
  if (bot.self?.dead && !bot.wasDead) { bot.journal(`☠️ I fell in battle near (${Math.round(bot.self.x)}, ${Math.round(bot.self.z)}). Releasing spirit.`); partyLog(`**${bot.charName}** died.`); }
  if (!bot.self?.dead && bot.wasDead) bot.journal('🔄 Back on my feet.');
  bot.wasDead = !!bot.self?.dead;
}

// ---- hot-reloadable brain: all per-tick decision logic lives in
// scripts/multibox_brain.mjs and is re-imported live whenever that file changes,
// so behavior can be tuned WITHOUT restarting (no relog). ----
let brain = null, brainMtime = 0, lastBrainStat = 0;
async function loadBrain() {
  // throttle: stat the brain file at most ~1x/sec, not every ~110ms tick (the first load,
  // brainMtime===0, is never throttled so startup still picks it up immediately).
  const now = Date.now();
  if (brainMtime && now - lastBrainStat < 1000) return;
  lastBrainStat = now;
  let m; try { m = statSync(BRAIN_URL).mtimeMs; } catch { return; }
  if (m === brainMtime) return;
  try {
    const mod = await import(`${BRAIN_URL.href}?v=${m}`);
    if (typeof mod.tick !== 'function') throw new Error('brain has no tick() export');
    brain = mod; brainMtime = m;
    log(`🧠 brain loaded live: ${BRAIN_PATH || 'multibox_brain.mjs'} (hot-reload on save)`);
    try { partyLog('🧠 behavior hot-reloaded — no relog.'); } catch {}
  } catch (e) { log(`brain reload failed: ${e.message} (keeping previous brain)`); }
}

async function main() {
  const specs = (cfg.bots ?? []).slice(0, 5);
  if (!specs.length) { console.error('config has no bots'); process.exit(1); }

  const tokens = new Map();
  for (const user of new Set(specs.map((s) => s.user))) {
    // Support pre-fetched bearer tokens (from scripts/browser_auth.mjs or manual export).
    // When the server has the Cloudflare Turnstile gate on /api/login, direct password
    // logins from Node will be rejected; use a real browser once to obtain the game token,
    // then provide it via ${USER}_TOKEN or WOC_TOKEN_${USER} and multibox will skip the
    // password login step entirely (the token is used directly for /characters + WS auth).
    let token = process.env[`${user.toUpperCase()}_TOKEN`] || process.env[`WOC_TOKEN_${user.toUpperCase()}`] || TOKENS_FILE[user] || TOKENS_FILE[user.toUpperCase()];
    if (token) {
      log(`using pre-fetched token for ${user}`);
    } else {
      const res = await api('/api/login', { username: user, password: passwordFor(user) });
      if (res.status !== 200 || !res.body.token) throw new Error(`login failed for ${user} (${res.status}): ${res.body.error ?? ''}`);
      token = res.body.token;
      log(`logged in: ${user}`);
    }
    tokens.set(user, token);
  }

  // optional staggered joins: instead of every character popping in at once, space
  // each join out by a RANDOM interval so the party trickles in like separate people.
  // Config: "joinStagger": true (→ 45-90s) or { "min": 30, "max": 120 } seconds.
  const sj = cfg.joinStagger;
  const joinWaitMs = () => {
    if (!sj) return 0;
    const mn = (typeof sj === 'object' && sj.min != null) ? sj.min : 45;
    const mx = (typeof sj === 'object' && sj.max != null) ? sj.max : 90;
    return Math.round((mn + Math.random() * Math.max(0, mx - mn)) * 1000);
  };

  const bots = [];
  try {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const token = tokens.get(spec.user);
      const chars = (await api('/api/characters', null, token, 'GET')).body.characters ?? [];
      let c = chars.find((x) => x.name.toLowerCase() === spec.character.toLowerCase());
      if (!c && spec.class) { const made = await api('/api/characters', { name: spec.character, class: spec.class }, token); if (made.status !== 200) throw new Error(`create "${spec.character}" failed: ${made.body.error ?? made.status}`); c = made.body; }
      if (!c) throw new Error(`character "${spec.character}" not found on ${spec.user}. Add "class" to auto-create.`);
      if (c.online) {
        // A stale GHOST session (crashed prior launch / closed tab) leaves the char "online" and would block
        // this login for the server's multi-minute reap grace, spiralling the supervisor. Reclaim it: the
        // ownership-gated takeover endpoint force-disconnects the old session and frees the slot. Then connect.
        log(`${c.name} shows online (stale ghost) — taking over the session`);
        const t = await api(`/api/characters/${c.id}/takeover`, {}, token);
        if (t.status !== 200) throw new Error(`"${c.name}" is already in the world and takeover failed (${t.status}): ${t.body?.error ?? ''}`);
        await sleep(1500); // let leave()/save free the sessionsByCharacterId slot before we re-enter
      }
      // trickle the joins (skip the wait before the very first one)
      if (i > 0) { const w = joinWaitMs(); if (w) { log(`⏳ staggering ${spec.character}'s join by ${Math.round(w / 1000)}s`); await sleep(w); } }
      const bot = new Bot(spec);
      // fresh journal header for this run
      writeFileSync(bot.jpath(), `# ${c.name} — ${c.class}\n_${PERSONA[c.class]?.voice ?? c.class}. Journal opened ${new Date().toISOString()}._\n\n`);
      await bot.connect(token, c.id, c.class, c.level);
      log(`in world: ${c.name} (${c.class} L${c.level}) pid=${bot.pid}`);
      bot.journal(`Entered the world at level ${c.level}.`);
      bots.push(bot);
    }
  } catch (err) {
    // A mid-login failure (ghost collision, connect timeout, bad name) would otherwise leave the bots that
    // ALREADY joined with open sockets — a hard process exit turns those into GHOST-online characters that
    // block the next relaunch ("X is already in the world"), spiralling the supervisor's retries. Close the
    // joined sockets CLEANLY first (the server reaps the session on ws close), then re-throw so the
    // supervisor waits out any remaining ghost grace and retries the FULL party together.
    log(`login failed (${err.message}); closing ${bots.length} already-joined bot(s) cleanly to avoid ghost sessions`);
    for (const b of bots) { try { b.shuttingDown = true; b.ws?.close(); } catch {} }
    await sleep(2000);
    throw err;
  }
  await sleep(800);

  const leader = bots.find((b) => b.charName.toLowerCase() === LEADER_NAME) ?? bots[0];
  const tank = bots.find((b) => b.cls === 'warrior') ?? bots.find((b) => MELEE.has(b.cls)) ?? leader;
  leader._ptag = cfg.tag ?? ''; // the brain's leaderSay() reads this to tag its lines too
  leader._partyPath = partyPath; // ...and writes its party-log lines to THIS party's file
  // graceful STAGGERED shutdown: log the party out ONE AT A TIME in combat-role order —
  // DPS first, then the healer, then the tank (who holds the line until last) — with a random
  // 5–15s gap between each. A whole party blinking offline at once reads as a bot; trickling
  // out by role over a couple minutes looks like people leaving. The remaining bots keep
  // playing (the tick loop runs on) until it's each one's turn. Closing the socket lets the
  // SERVER reap the session immediately (a bare kill leaves a ghost-online char that blocks relaunch).
  let loggingOut = false;
  const logoutOrder = (b) => (b === tank ? 0 : b.isHealer() ? 1 : 2); // TANK/leader first, then healer, then dps (operator preference)
  const roleName = (b) => (b === tank ? 'tank' : b.isHealer() ? 'healer' : 'dps');
  const gracefulLogout = async () => {
    if (loggingOut) { process.exit(0); return; } // impatient 2nd Ctrl-C / SIGTERM → force quit now
    loggingOut = true;
    const order = [...bots].sort((a, b) => logoutOrder(a) - logoutOrder(b));
    try { partyLog('🛑 staggered logout — tank/leader → healer → dps, 5–15s apart.'); } catch {}
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      b.shuttingDown = true; // stops the tick loop touching it + blocks auto-reconnect
      try { b.cmd({ cmd: 'stopattack' }); } catch {}
      try { b.input({}); } catch {} // stand still
      try { b.ws?.close(); } catch {}
      try { partyLog(`🚪 ${b.charName} (${roleName(b)}) logged out.`); } catch {}
      if (i < order.length - 1) {
        const wait = 5000 + Math.floor(Math.random() * 10000); // 5–15s, random
        try { partyLog(`⏳ next out in ~${Math.round(wait / 1000)}s…`); } catch {}
        await sleep(wait);
      }
    }
    setTimeout(() => process.exit(0), 600);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, gracefulLogout);
  // APPEND a session banner (don't truncate) — the consolidated party.md is shared by every
  // party, so overwriting it would wipe the other party's live log. Seed a fresh file only if
  // it doesn't exist yet; otherwise just mark this party's (re)join.
  if (!existsSync(partyPath)) writeFileSync(partyPath, `# Party log\n\n`);
  partyLog(`▶️ session start — Leader ${leader.charName} (${leader.cls}), Tank ${tank.charName}.`);
  partyLog(`Party assembled: ${bots.map((b) => `${b.charName} (${b.cls})`).join(', ')}.`);
  log(`leader = ${leader.charName} (${leader.cls}); tank = ${tank.charName}`);

  for (const b of bots) { if (b !== leader) { leader.cmd({ cmd: 'pinvite', id: b.pid }); await sleep(300); b.cmd({ cmd: 'paccept' }); await sleep(300); } }
  await sleep(700);
  partyLog(`Party of ${leader.self?.party?.members?.length ?? 1} formed.`);
  for (const b of bots) { const ab = OPENING_BUFF[b.cls]; if (ab) b.cmd({ cmd: 'cast', ability: ab }); }
  // PANIC WATCH: friend each watched player so the server pushes us a "has come online" notice the moment
  // they log in (one-way; they aren't alerted). The main loop scans for that notice and hard-kills the fleet.
  const PANIC_NAMES = (Array.isArray(cfg.panicOnPlayer) ? cfg.panicOnPlayer : (cfg.panicOnPlayer ? [cfg.panicOnPlayer] : [])).filter(Boolean);
  if (PANIC_NAMES.length) { for (const n of PANIC_NAMES) leader.cmd({ cmd: 'friend_add', name: n }); partyLog(`👁️ panic-watch armed for: ${PANIC_NAMES.join(', ')} (auto-kill on their login).`); }
  const PANIC_LC = PANIC_NAMES.map((n) => String(n).toLowerCase());
  await sleep(500);

  const start = Date.now();
  let lastStatus = 0, lastBuff = Date.now(), lastProgress = Date.now();
  let phase = 'grind'; // grind -> travel -> dungeon
  const lootQueue = new Map();
  const state = { roamHeading: 0, roamUntil: 0, lastLeaderPos: null, lastMoveCheck: 0 };
  let lastReparty = Date.now(), arrived = false;
  let lastOutbox = 0; const outboxPump = makeOutboxPump(); // two-way chat relay (see multibox_chat.mjs)
  await loadBrain();
  if (!brain) throw new Error('could not load scripts/multibox_brain.mjs');

  while (Date.now() - start < RUN_SECONDS * 1000) {
    if (!leader.self) { await sleep(200); continue; }
    if (existsSync(STOP_FILE)) { partyLog(`${PTAG}🛑 ${STOP_FILE} seen — logging the party out.`); break; }
    const alive = bots.filter((b) => b.self && !b.self.dead);
    const minLevel = Math.min(...bots.map((b) => b.self?.lv ?? 1));

    // phase transitions — ONLY when actually seeking the crypt; otherwise we just grind `home`
    // seekCrypt may be set per-party in cfg.combat (overrides the global default in the brain).
    const seekingCrypt = cfg.combat?.seekCrypt ?? brain?.TUNABLES?.seekCrypt;
    if (seekingCrypt && phase === 'grind' && minLevel >= DUNGEON_LEVEL) { phase = 'travel'; partyLog(`Whole party is level ${minLevel}+ — marching to ${DUNGEON.name} door at (${CRYPT_DOOR.x}, ${CRYPT_DOOR.z}).`); leader.journal(`We are ready. To ${DUNGEON.name}.`); }
    if (seekingCrypt && phase === 'travel' && leader.self.x > 500) { phase = 'dungeon'; partyLog(`Zoned into ${DUNGEON.name}. Elites ahead.`); for (const b of bots) b.journal(`🏰 Crossed the threshold into ${DUNGEON.name}.`); }
    if (seekingCrypt && !arrived && leader.dist(CRYPT_DOOR) < 50) { arrived = true; partyLog(`📍 Reached the ${DUNGEON.name} approach.`); }

    if (Date.now() - lastStatus > 10_000) {
      lastStatus = Date.now();
      const T = brain?.TUNABLES ?? {};
      // the camp the brain actually committed to this tick (state.curCampSpot), else the resolved anchor.
      const camp = state.curCampSpot ?? (T.seekCrypt ? CRYPT_DOOR : (state.homePt ?? T.home ?? CRYPT_DOOR));
      const goalName = T.seekCrypt ? 'crypt' : 'camp';
      // VERBOSE per-bot telemetry so we can SEE behavior, not guess: level · hp% · mana% · position ·
      // distance-to-camp · current target name · nearby-add count · whether the server says we're swimming.
      const detail = bots.map((b) => {
        if (!b.self) return `${b.charName.slice(0, 6)}:offline`;
        const x = Math.round(b.self.x), z = Math.round(b.self.z);
        if (b.self.dead) return `${b.charName.slice(0, 6)}:☠️@(${x},${z})`;
        const tgt = b.self.target != null ? (b.ents.get(b.self.target)?.nm ?? `#${b.self.target}`) : '—';
        const adds = b.hostiles().filter((m) => b.dist(m) < 16).length;
        const mana = b.self.mres ? `/m${Math.round((b.self.res / b.self.mres) * 100)}` : '';
        const swim = (b.self.y != null && b.self.y < -5.25) ? '🌊SWIM' : ''; // body below the swim surface (WATER_LEVEL-0.75)
        // ROTATION TELEMETRY: what the bot is doing RIGHT NOW — ⚡casting an ability, ·gcd (just cast, locked),
        // or — (free: auto-attacking / idle). Lets us watch the rotation fire and spot stalls/idle/oom gaps.
        const act = b.self.cast ? `⚡${String(b.self.cast).replace(/_/g, '')}` : ((b.self.gcd ?? 0) > 0.1 ? '·gcd' : '·auto');
        return `${b.charName.slice(0, 6)} L${b.self.lv} hp${Math.round(b.hpFrac() * 100)}${mana} @(${x},${z})${swim} d${Math.round(b.dist(camp))}y ▸${tgt} ${act}${adds ? ` [${adds}m]` : ''}`;
      }).join('  |  ');
      // throughput at a glance: kills/min + XP/hr since the run started.
      const mins = Math.max(1 / 60, (Date.now() - start) / 60000);
      const kpm = (bots.reduce((s, b) => s + b.kills, 0) / mins).toFixed(1);
      const xph = Math.round(bots.reduce((s, b) => s + (b.xpGained ?? 0), 0) / mins * 60);
      const doing = leader._intent ? ` · ${leader._intent}` : '';
      const tag = `[${phase}] ${goalName}(${Math.round(camp.x)},${Math.round(camp.z)}) ${kpm}k/m ${xph}xp/h${doing}`;
      log(`${tag}  ${detail}`);
      // The 10s position status floods the party tab. For a dungeonFarm party it stays on the console /
      // session log only; the party tab gets the relevant combat narration (pulls, bosses, loot, wipes).
      if (!cfg.combat?.dungeonFarm) partyLog(`${tag}  ${detail}`);
    }
    const reBuff = Date.now() - lastBuff > 45_000; if (reBuff) lastBuff = Date.now();

    // machine-readable progress beat every 5 min (the CI monitor parses these)
    if (Date.now() - lastProgress > 300_000) {
      lastProgress = Date.now();
      const totalKills = bots.reduce((s, b) => s + b.kills, 0);
      const levels = bots.map((b) => b.self?.lv ?? 1);
      partyLog(`📊 PROGRESS kills=${totalKills} levels=[${levels.join(',')}] phase=${phase} elapsed=${Math.round((Date.now() - start) / 60000)}m`);
    }

    // keep the party intact across reconnects: re-invite any connected member who fell out of the party.
    // SKIPPED for a dungeonFarm party — the BRAIN owns all (dis)assembly there (it deliberately disbands +
    // reforms to reset the instance), so the orchestrator must not re-invite mid-reform and fight it.
    if (!cfg.combat?.dungeonFarm && Date.now() - lastReparty > 15_000) {
      lastReparty = Date.now();
      const members = new Set((leader.self?.party?.members ?? []).map((m) => m.pid));
      for (const b of bots) { if (b !== leader && b.connected && b.pid > 0 && !members.has(b.pid)) { leader.cmd({ cmd: 'pinvite', id: b.pid }); b.cmd({ cmd: 'paccept' }); } }
    }

    // ---- narrate from real events, then run the HOT-RELOADABLE brain ----
    for (const b of bots) { if (b.self) { narrate(b, leader.pid, lootQueue); relayInbound(cfg.tag ?? '', b); } } // relayInbound still captures incoming whispers to the dashboard inbox; we just don't spam them into party.md / journals anymore
    if (Date.now() - lastOutbox > 900) { lastOutbox = Date.now(); outboxPump(bots, (b, txt) => b.journal(`💬➡️ sent: ${txt}`)); } // operator replies from the dashboard
    // WHISPER KILL-SWITCH: an AUTHORIZED player whispering the logout phrase logs the party out
    // AND exits the process (no auto-reconnect). cfg.control = { logout: "logout", from: [names] };
    // empty `from` = anyone (don't do that on a public realm). Checked before events are cleared.
    {
      const ctl = cfg.control ?? {};
      const phrase = String(ctl.logout ?? 'logout').toLowerCase();
      const from = (ctl.from ?? []).map((x) => String(x).toLowerCase());
      let killer = null;
      for (const b of bots) for (const ev of (b.events ?? [])) {
        if (ev.type !== 'chat' || ev.channel !== 'whisper') continue;
        const f = String(ev.from ?? '').toLowerCase(), t = String(ev.text ?? '').trim().toLowerCase();
        if ((from.length === 0 || from.includes(f)) && (t === phrase || t === '!' + phrase)) killer = ev.from;
      }
      if (killer) { try { partyLog(`🛑 logout whisper from **${killer}** — logging out + exiting (no reconnect).`); } catch {} gracefulLogout(); return; }
    }
    // PANIC: a watched player logged on (server pushed a "<name> has come online." friend notice) →
    // HARD-KILL the entire fleet immediately (no graceful logout — just vanish). Anti-detection switch.
    if (PANIC_LC.length) {
      for (const b of bots) for (const ev of (b.events ?? [])) {
        if (ev.type !== 'log') continue;
        const t = String(ev.text ?? '').toLowerCase();
        if (!PANIC_LC.some((n) => t.includes(n))) continue;
        try { partyLog(`👁️ panic-watch notice: ${ev.text}`); } catch {} // visibility: friend-add result + presence (online/offline)
        if (t.includes('come online')) {
          try { partyLog(`🚨 PANIC — "${ev.text}" — HARD-KILLING all multibox processes NOW.`); } catch {}
          try { execSync('pkill -f "node scripts/multibox.mjs"'); } catch {}
          process.exit(0);
        }
      }
    }
    await loadBrain(); // picks up live edits to scripts/multibox_brain.mjs — no relog
    // a runtime throw inside tick() (e.g. a half-saved live edit) must NOT crash the
    // whole unattended run — log it once and skip the tick; next good save recovers.
    if (brain) {
      try {
        brain.tick({ bots, leader, tank, lootQueue, phase, arrived, now: Date.now(), CRYPT_DOOR, dungeon: DUNGEON, HEAL_SPELL, OPENING_BUFF, MELEE, reBuff, state, grind: cfg.grind, questing: cfg.questing, combat: cfg.combat });
      } catch (err) {
        if (state._lastTickErr !== String(err?.message)) { state._lastTickErr = String(err?.message); partyLog(`⚠️ brain tick error (skipped, run continues): ${err?.message}`); }
      }
    }
    for (const b of bots) b.events = [];
    await sleep(Math.max(50, brain?.TUNABLES?.tickMs ?? 110)); // live-tunable loop period (floor = server tick)
  }

  partyLog('Run complete — disconnecting.');
  for (const b of bots) { b.shuttingDown = true; b.journal('— session ended —'); b.cmd({ cmd: 'stopattack' }); }
  await sleep(300);
  for (const b of bots) { try { b.ws.close(); } catch {} }
  log('done. journals in ./logs/');
  process.exit(0);
}

main().catch((err) => { console.error('fatal:', err.message); try { partyLog(`FATAL: ${err.message}`); } catch {} process.exit(1); });
