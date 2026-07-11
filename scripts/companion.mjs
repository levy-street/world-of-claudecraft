// companion.mjs — a single follower bot that plays alongside a HUMAN-controlled
// leader (you log into e.g. ryzetank in a real browser; this drives ryzeheal).
//
// What it does, each ~tick:
//   • auto-ACCEPTS a party invite from your character (no LLM, just the server's
//     `partyInvite` event → `paccept`),
//   • FOLLOWS you with a stable per-bot offset (delta-split — it orbits a point
//     beside you instead of stacking on your tile / trailing your exact path),
//   • HEALS the party (dying-first triage → you/tank → most-hurt) + keeps
//     Power Word: Shield on you (priest),
//   • ASSISTS — attacks whatever is hitting you (finds the mob aggroed on your
//     pid) and weaves a class nuke when mana is healthy,
//   • on IDLE (you stand still, out of combat, for a few seconds) grabs / turns
//     in quests at the nearest giver within a leash, then snaps back to you.
//
// Run (token from multibox.tokens.json or RYZE3_TOKEN env, like the fleet):
//   node scripts/companion.mjs                       # defaults: ryzeheal follows ryzetank
//   node scripts/companion.mjs scripts/companion.json
//
// It is one socket / one character — NOT a multibox. Turnstile-gated prod: it
// reuses the same pre-fetched bearer tokens as scripts/multibox.mjs.

import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { loadConfig } from './multibox_config.mjs';
import { relayInbound, makeOutboxPump } from './multibox_chat.mjs';

try { process.loadEnvFile(); } catch {}

const cfgPath = process.argv[2] ?? 'scripts/companion.json';
const cfg = loadConfig(cfgPath);
const BASE = (cfg.server ?? 'https://worldofclaudecraft.com').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const LOG_DIR = 'logs';
const STOP_FILE = process.env.MULTIBOX_STOPFILE ?? 'multibox.stop';

let TOKENS_FILE = {};
try { if (existsSync('multibox.tokens.json')) TOKENS_FILE = JSON.parse(readFileSync('multibox.tokens.json', 'utf8')); } catch {}

const spec = cfg.bot ?? { user: 'ryze3', character: 'ryzeheal', class: 'priest' };
const LEADER_NAME = String(cfg.leaderName ?? 'ryzetank').toLowerCase();
const FOLLOW = cfg.follow ?? {};
const FOLLOW_DIST = FOLLOW.distance ?? 6;       // hold within this many yards of your side
const DELTA_R = FOLLOW.deltaRadius ?? 4;        // formation offset radius (the "delta split")
const LEASH_MAX = FOLLOW.leashMax ?? 45;        // never wander further than this from you
const IDLE_SEC = cfg.idleSeconds ?? 4;          // you idle this long → use the downtime for quests
const QUEST_LEASH = cfg.questLeash ?? 55;       // only visit givers within this of you
const TAG = cfg.tag ? cfg.tag + ' ' : '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${TAG}${m}`);
const jpath = `${LOG_DIR}/${spec.character}.companion.md`;
const journal = (line) => { try { appendFileSync(jpath, `- \`${stamp()}\` ${line}\n`); } catch {} };

async function api(path, body, token, method = 'POST') {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', 'Origin': BASE, 'User-Agent': 'Mozilla/5.0', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- delta-snapshot reconstruction (mirrors the server wire format, same as multibox.mjs) ---
const DELTA_SELF_KEYS = ['inv', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'weapon', 'party', 'trade', 'duel', 'auras'];
const mergeSelf = (prev, next) => { if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k]; return next; };
const ID_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents ?? []) { const p = prevEnts.get(w.id); if (p && w.k === undefined) for (const key of ID_KEYS) if (key in p) w[key] = p[key]; next.set(w.id, w); }
  for (const id of snap.keep ?? []) { const p = prevEnts.get(id); if (p) next.set(id, p); }
  return next;
}

const HEAL_SPELL = { priest: 'lesser_heal', paladin: 'holy_light', druid: 'healing_touch', shaman: 'healing_wave' };
const NUKE = { priest: 'smite', shaman: 'lightning_bolt', druid: 'wrath', paladin: 'judgement' };
const MELEE = new Set(['warrior', 'paladin', 'rogue']);
const rangeMax = (cls) => (cls === 'hunter' ? 30 : MELEE.has(cls) ? 4 : 26);

class Bot {
  constructor(s) { this.user = s.user; this.charName = s.character; this.cls = s.class; this.pid = -1; this.self = null; this.ents = new Map(); this.events = []; this.connected = false; this.shuttingDown = false; }
  connect(token, charId) {
    this.token = token; this.charId = charId;
    return new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('connect timeout')); } }, 12000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })));
      this.ws.on('message', (data) => {
        let m; try { m = JSON.parse(String(data)); } catch { return; }
        if (m.t === 'hello') { this.pid = m.pid; this.connected = true; if (!settled) { settled = true; clearTimeout(to); resolve(); } }
        else if (m.t === 'error') { if (!settled) { settled = true; clearTimeout(to); reject(new Error(m.error ?? 'auth rejected')); } }
        else if (m.t === 'snap') { this.self = mergeSelf(this.self, m.self); this.ents = mergeEnts(this.ents, m); if (this.self) this.ents.set(this.self.id, this.self); }
        else if (m.t === 'events') this.events.push(...m.list);
      });
      this.ws.on('close', () => { this.connected = false; if (!this.shuttingDown) { const d = 2000 + Math.random() * 3000; journal(`🔌 dropped — reconnecting in ${(d / 1000).toFixed(1)}s`); setTimeout(() => this._reopen(), d); } });
      this.ws.on('error', () => { if (!settled) { settled = true; clearTimeout(to); reject(new Error('ws error')); } });
    });
  }
  _reopen() { this.connect(this.token, this.charId).then(() => journal('🔌 reconnected.')).catch(() => setTimeout(() => this._reopen(), 4000)); }
  cmd(p) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'cmd', ...p })); }
  input(mi, facing) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) })); }
  pos() { return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 }; }
  dist(o) { const p = this.pos(); return Math.hypot((o.x ?? 0) - p.x, (o.z ?? 0) - p.z); }
  faceTo(o) { const p = this.pos(); return Math.atan2((o.x ?? 0) - p.x, (o.z ?? 0) - p.z); }
  offGcd() { return (this.self?.gcd ?? 0) <= 0 && !this.self?.cast; }
  hpFrac() { return (this.self?.hp ?? 0) / Math.max(1, this.self?.mhp ?? 1); }
  manaFrac() { return (this.self?.res ?? 0) / Math.max(1, this.self?.mres ?? 1); }
  hostiles() { return [...this.ents.values()].filter((e) => e.k === 'mob' && !e.dead && e.h); }
}

// --- smooth, human-ish locomotion -----------------------------------------
// Movement must NOT read as a bot. The tells we avoid: start/stop chatter at a
// hard distance threshold (handled by the caller's hysteresis), snap/spin turns
// (we rate-limit rotation), laser-straight paths (a faint sway), random darting
// while idle (the stuck-escape only arms during genuine travel), and metronomic
// packet timing (the main loop jitters its period).
const TURN_RATE = 0.30; // max radians rotated per tick (~1s for a U-turn at ~110ms)
function smoothFace(bot, targetF) {
  // rate-limit from the ACTUAL server facing (self.f) when we have it, so a heal-cast
  // that reorients the character can't cause a snap on the next movement tick.
  const cur = bot.self?.f ?? bot._facing ?? targetF;
  let d = targetF - cur;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (d > TURN_RATE) d = TURN_RATE; else if (d < -TURN_RATE) d = -TURN_RATE;
  bot._facing = cur + d;
  return bot._facing;
}
const mv = { lastPos: null, lastChk: 0, escUntil: 0, escH: 0 };
function glide(bot, point, escapeBeyond = 8) {
  const now = Date.now();
  const far = bot.dist(point) > escapeBeyond; // only travel (not formation holds) can be "stuck"
  if (far && now - mv.lastChk > 1600) {
    if (mv.lastPos && Math.hypot(bot.self.x - mv.lastPos.x, bot.self.z - mv.lastPos.z) < 0.8) {
      mv.escH = bot.faceTo(point) + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.7); // veer, don't spin 360
      mv.escUntil = now + 1700;
    }
    mv.lastPos = { x: bot.self.x, z: bot.self.z }; mv.lastChk = now;
  }
  let target = now < mv.escUntil ? mv.escH : bot.faceTo(point);
  if (far && now >= mv.escUntil) target += Math.sin(now / 700 + (bot.pid || 1)) * 0.12; // organic drift on long runs
  bot.input({ f: 1 }, smoothFace(bot, target));
}
function holdStill(bot) { if (bot.self?.f != null) bot._facing = bot.self.f; bot.input({}); } // hold next to the leader; no emote/fidget spam
const moveToward = (bot, point) => glide(bot, point);

// DELTA-SPLIT: a stable per-pid offset (golden-angle so two followers spread),
// with a slow drift so it isn't a rigid lattice. Following a human at a fixed
// formation slot beats stacking on their exact tile / mirroring their path.
function deltaAnchor(bot, point) {
  const pid = bot.pid > 0 ? bot.pid : 1;
  const ang = (pid * 2.399963) % (Math.PI * 2);
  const drift = Math.sin(Date.now() / 9000 + pid) * (DELTA_R * 0.3);
  return { x: point.x + Math.cos(ang) * (DELTA_R + drift), z: point.z + Math.sin(ang) * (DELTA_R + drift) };
}

function partyOf(bot) { return bot.self?.party ?? null; }
function leaderMember(bot) {
  const party = partyOf(bot); if (!party) return null;
  return (party.members ?? []).find((m) => m.pid === party.leader) ?? null;
}

// quest givers from the (extends-resolved) config, used only during idle downtime
const GIVERS = (cfg.questing?.hubs ?? []).flatMap((h) => h.givers ?? []);
const idle = { leaderPos: null, since: 0 };

function tick(bot) {
  if (!bot.self || bot.self.dead) { if (bot.self?.dead) bot.cmd({ cmd: 'release' }); return; }
  const party = partyOf(bot);

  // 1) AUTO-ACCEPT invites — accept any pending partyInvite while not grouped
  for (const ev of bot.events) {
    if (ev.type === 'partyInvite' && (ev.pid === undefined || ev.pid === bot.pid)) {
      bot.cmd({ cmd: 'paccept' });
      journal(`🤝 accepted party invite from **${ev.fromName ?? 'leader'}**.`);
      log(`accepted invite from ${ev.fromName ?? '?'}`);
    }
  }
  for (const ln of relayInbound(cfg.tag ?? '', bot)) journal(ln);  // pipe whispers to the dashboard
  bot.events = [];

  // not in a party yet → hold position and wait to be invited
  if (!party || !party.members?.length) { bot.input({}); return; }
  const lead = leaderMember(bot);
  if (!lead) { bot.input({}); return; }
  const leadPos = { x: lead.x, z: lead.z };
  const distLead = bot.dist(leadPos);

  // 1.5) DUNGEON FOLLOW — when the leader has zoned into an instance (the far-off x-bands at
  //      ~900/1500/2100) and we're still in the overworld, walk to the configured dungeon door and
  //      enter the SAME instance so we don't get stranded outside. Reverse: if the leader has left
  //      and we're still inside, head for the exit. Party member x/z are world-absolute even across
  //      instances (server builds them from the global entity), so lead.x crossing 500 reliably
  //      signals "they zoned". Gated on cfg.dungeon, so the plain overworld companion is unchanged.
  const DUNGEON = cfg.dungeon;
  if (DUNGEON?.door) {
    const meIn = (bot.self.x ?? 0) > 500, leadIn = (lead.x ?? 0) > 500;
    if (leadIn && !meIn) {
      if (bot.dist(DUNGEON.door) < 6) {
        bot.input({});
        if (Date.now() - (bot._enterAt ?? 0) > 1500) { bot._enterAt = Date.now(); bot.cmd({ cmd: 'enter_dungeon', dungeon: DUNGEON.id }); journal(`🏰 following the leader into ${DUNGEON.name ?? DUNGEON.id}.`); }
      } else moveToward(bot, DUNGEON.door);
      return;
    }
    if (meIn && !leadIn) {
      const exit = [...bot.ents.values()].find((e) => e.tid === 'dungeon_exit');
      if (exit) { if (bot.dist(exit) < 6) { bot.cmd({ cmd: 'leave_dungeon' }); bot.input({}); } else moveToward(bot, exit); return; }
    }
  }

  // 2) HEAL TRIAGE (dying → leader/tank → most hurt). Always preempts everything.
  if (HEAL_SPELL[bot.cls] && bot.offGcd()) {
    const mem = (party.members ?? []).filter((m) => !m.dead && m.mhp);
    const frac = (m) => m.hp / m.mhp;
    const crit = mem.filter((m) => frac(m) < 0.35).sort((a, b) => frac(a) - frac(b))[0];
    const tank = mem.find((m) => m.pid === party.leader && frac(m) < 0.9); // heal the leader proactively (was 0.6)
    const low = mem.filter((m) => frac(m) < 0.85).sort((a, b) => frac(a) - frac(b))[0];
    const who = crit ?? tank ?? low;
    if (who && bot.manaFrac() > 0.08) {
      bot.cmd({ cmd: 'target', id: who.pid });
      bot.cmd({ cmd: 'cast', ability: HEAL_SPELL[bot.cls] });
      return;
    }
  }
  // (Power Word: Shield removed — underpowered; mana goes to healing.)

  // 3) healer self-kite — step out of melee before doing anything else
  const onMe = bot.hostiles().filter((m) => bot.dist(m) < 6).sort((a, b) => bot.dist(a) - bot.dist(b))[0];
  if (onMe && bot.hpFrac() < 0.85 && HEAL_SPELL[bot.cls]) { bot.cmd({ cmd: 'stopattack' }); bot.input({ f: 1 }, smoothFace(bot, bot.faceTo(onMe) + Math.PI)); return; }

  // 4) ASSIST — attack whatever is hitting the leader (mob aggroed on the leader's pid),
  //    else the nearest hostile clustered on the leader. Wand + class nuke when mana is healthy.
  let foe = bot.hostiles().filter((m) => m.aggro === party.leader).sort((a, b) => bot.dist(a) - bot.dist(b))[0];
  if (!foe && lead?.inCombat) foe = bot.hostiles().filter((m) => Math.hypot((m.x ?? 0) - leadPos.x, (m.z ?? 0) - leadPos.z) < 16).sort((a, b) => bot.dist(a) - bot.dist(b))[0];
  if (foe && distLead < LEASH_MAX) {
    if (bot.dist(foe) > rangeMax(bot.cls)) { moveToward(bot, foe); return; }
    if (bot.self.target !== foe.id) bot.cmd({ cmd: 'target', id: foe.id });
    bot.input({}, smoothFace(bot, bot.faceTo(foe)));
    bot.cmd({ cmd: 'attack' });                       // wand / auto-attack ONLY — free, no mana
    return;                                            // no damage NUKE: mana is for heals (user request)
  }

  // 5) IDLE QUEST PICKUP — you're standing still, out of combat, for IDLE_SEC.
  const now = Date.now();
  const leaderStill = idle.leaderPos && Math.hypot(leadPos.x - idle.leaderPos.x, leadPos.z - idle.leaderPos.z) < 2;
  if (!leaderStill) { idle.leaderPos = leadPos; idle.since = now; }
  const leaderIdle = !lead.inCombat && leaderStill && now - idle.since > IDLE_SEC * 1000;
  if (leaderIdle && GIVERS.length) {
    const giver = GIVERS
      .filter((g) => Math.hypot(g.x - leadPos.x, g.z - leadPos.z) < QUEST_LEASH)
      .sort((a, b) => bot.dist(a) - bot.dist(b))[0];
    if (giver) {
      if (bot.dist(giver) < 2.5) { bot.input({}); if (now - (bot._qIa ?? 0) > 800) { bot._qIa = now; bot.cmd({ cmd: 'interact' }); } }
      else moveToward(bot, giver);
      return;
    }
  }

  // 6) FOLLOW with delta-split + HYSTERESIS — ease in and HOLD. A hard distance
  //    threshold makes the bot stutter-step (move a tick, stop a tick) right at the
  //    edge, which is an obvious tell. Start moving only past the outer radius; keep
  //    gliding until inside the inner radius; then hold still. Anchor drift stays
  //    inside the deadzone so it never re-triggers a move on its own.
  const anchor = deltaAnchor(bot, leadPos);
  const dA = bot.dist(anchor);
  const inner = Math.max(1.5, FOLLOW_DIST - 2.5);
  if (bot._moving) { if (dA <= inner) bot._moving = false; }
  else if (dA > FOLLOW_DIST) bot._moving = true;
  if (bot._moving) glide(bot, anchor); else holdStill(bot);
}

async function main() {
  const user = spec.user;
  let token = process.env[`${user.toUpperCase()}_TOKEN`] || process.env[`WOC_TOKEN_${user.toUpperCase()}`] || TOKENS_FILE[user] || TOKENS_FILE[user.toUpperCase()];
  if (token) log(`using pre-fetched token for ${user}`);
  else {
    const acc = (cfg.accounts ?? {})[user];
    const pass = process.env[acc?.passEnv ?? `${user.toUpperCase()}_PASS`] ?? acc?.pass;
    if (!pass) throw new Error(`no token or password for ${user} (capture a token: see scripts/MULTIBOX.md)`);
    const res = await api('/api/login', { username: user, password: pass });
    if (res.status !== 200 || !res.body.token) throw new Error(`login failed for ${user} (${res.status}): ${res.body.error ?? ''} — Turnstile? use a token.`);
    token = res.body.token; log(`logged in: ${user}`);
  }

  const chars = (await api('/api/characters', null, token, 'GET')).body.characters ?? [];
  const c = chars.find((x) => x.name.toLowerCase() === spec.character.toLowerCase());
  if (!c) throw new Error(`character "${spec.character}" not found on ${user}`);
  if (c.online) throw new Error(`"${c.name}" is already in the world — log it out first.`);

  const bot = new Bot(spec);
  writeFileSync(jpath, `# ${c.name} — companion of ${cfg.leaderName ?? '?'}\n_Opened ${new Date().toISOString()}._\n\n`);
  await bot.connect(token, c.id);
  log(`in world: ${c.name} (${c.class} L${c.level}) pid=${bot.pid} — waiting for an invite from ${cfg.leaderName}`);
  journal(`Entered the world at L${c.level}. Invite **${c.name}** to your party and I'll follow, heal, and assist.`);

  let loggingOut = false;
  const graceful = async () => {
    if (loggingOut) process.exit(0);
    loggingOut = true; bot.shuttingDown = true;
    journal('🚪 logging out.'); try { bot.cmd({ cmd: 'stopattack' }); bot.cmd({ cmd: 'pleave' }); } catch {}
    await sleep(400); try { bot.ws?.close(); } catch {}
    setTimeout(() => process.exit(0), 500);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, graceful);

  let lastOutbox = 0; const outboxPump = makeOutboxPump();
  while (!loggingOut) {
    if (existsSync(STOP_FILE)) { journal('🛑 stop file seen.'); await graceful(); break; }
    try { tick(bot); } catch (e) { journal(`⚠️ tick error: ${e.message}`); }
    if (Date.now() - lastOutbox > 900) { lastOutbox = Date.now(); outboxPump([bot], (b, txt) => journal(`💬➡️ sent: ${txt}`)); }
    await sleep(95 + Math.floor(Math.random() * 50)); // jittered (~95-145ms): non-metronomic cadence
  }
}

main().catch((e) => { console.error('fatal:', e.message); journal(`FATAL: ${e.message}`); process.exit(1); });
