// hunter_agent.mjs — an autonomous agent that plays YOUR hunter on a live realm.
//
// It logs in as your account, takes over your hunter character, and grinds mobs
// to level up: keeps Aspect of the Hawk up, kites to ranged distance, auto-shoots,
// weaves Serpent Sting + Arcane Shot, loots kills, and rests to regen. It disengages
// and flees when low on health rather than feeding deaths on a production realm.
//
// IMPORTANT: a character can only be in the world once (server rejects a second
// login with "character already in world"). LOG OUT of your hunter in the browser
// before starting this, or the agent can't connect.
//
// Config via environment (never hardcode your password):
//   SERVER_URL    public realm URL, e.g. https://play.example.com   (default http://localhost:8787)
//   WOC_USER      your account username                              (required)
//   WOC_PASS      your account password                              (required)
//   WOC_CHARACTER your hunter's name (optional; else first hunter on the account)
//   RUN_SECONDS   how long to play before disconnecting              (default 1800)
//
// Run:  WOC_USER=you WOC_PASS=secret WOC_CHARACTER=Yourhunter \
//       SERVER_URL=https://your-realm node scripts/hunter_agent.mjs
//
// Tip: park the hunter in a safe grinding spot of level-appropriate mobs before
// starting — the agent fights what's nearby and only wanders gently to find more.

import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const USER = process.env.WOC_USER;
const PASS = process.env.WOC_PASS;
const WANT_NAME = process.env.WOC_CHARACTER ?? null;
const RUN_SECONDS = Number(process.env.RUN_SECONDS ?? 1800);

if (!USER || !PASS) {
  console.error('Set WOC_USER and WOC_PASS env vars (see header of this file). Aborting.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function api(path, body, token, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Origin': BASE, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- delta-snapshot reconstruction (mirrors the server wire format; copied from
// the other ws scripts so heavy/identity fields carry over between snapshots) ---
const DELTA_SELF_KEYS = ['inv', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'weapon', 'party', 'trade', 'duel', 'auras'];
function mergeSelf(prev, next) {
  if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k];
  return next;
}
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents ?? []) {
    const prev = prevEnts.get(w.id);
    if (prev && w.k === undefined) for (const key of ENTITY_IDENTITY_KEYS) if (key in prev) w[key] = prev[key];
    next.set(w.id, w);
  }
  for (const id of snap.keep ?? []) {
    const prev = prevEnts.get(id);
    if (prev) next.set(id, prev);
  }
  return next;
}

class Hunter {
  constructor() {
    this.pid = -1;
    this.self = null;
    this.ents = new Map();
    this.events = [];
  }

  async login() {
    const res = await api('/api/login', { username: USER, password: PASS });
    if (res.status !== 200 || !res.body.token) throw new Error(`login failed (${res.status}): ${res.body.error ?? ''}`);
    this.token = res.body.token;
    log(`logged in as ${res.body.username}`);

    const chars = await api('/api/characters', null, this.token, 'GET');
    const list = chars.body.characters ?? [];
    const hunters = list.filter((c) => c.class === 'hunter');
    const pick = WANT_NAME
      ? list.find((c) => c.name.toLowerCase() === WANT_NAME.toLowerCase())
      : hunters[0];
    if (!pick) throw new Error(`no matching character. hunters on account: ${hunters.map((c) => c.name).join(', ') || '(none)'}`);
    if (pick.class !== 'hunter') log(`WARNING: ${pick.name} is a ${pick.class}, not a hunter — rotation is hunter-specific.`);
    if (pick.online) throw new Error(`${pick.name} is already in the world — log it out in the browser first.`);
    this.charId = pick.id;
    this.name = pick.name;
    log(`selected ${pick.name} (${pick.class}, level ${pick.level}) on realm ${chars.body.realm}`);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('connect timeout')), 10000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })));
      this.ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (msg.t === 'hello') { this.pid = msg.pid; clearTimeout(to); resolve(); }
        else if (msg.t === 'error') { clearTimeout(to); reject(new Error(`server: ${msg.error ?? msg.msg ?? 'auth rejected'}`)); }
        else if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.ents = mergeEnts(this.ents, msg);
          if (this.self) this.ents.set(this.self.id, this.self);
        } else if (msg.t === 'events') this.events.push(...msg.list);
      });
      this.ws.on('error', reject);
      this.ws.on('close', () => { if (this.pid > 0) log('socket closed by server.'); });
    });
    log(`in the world as pid ${this.pid}`);
  }

  cmd(p) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'cmd', ...p })); }
  input(mi, facing) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) })); }

  pos() { return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 }; }
  dist(o) { const p = this.pos(); return Math.hypot(o.x - p.x, o.z - p.z); }
  faceTo(o) { const p = this.pos(); return Math.atan2(o.x - p.x, o.z - p.z); }
  hpFrac() { return (this.self?.hp ?? 0) / Math.max(1, this.self?.mhp ?? 1); }
  manaFrac() { return (this.self?.res ?? 0) / Math.max(1, this.self?.mres ?? 1); }
  inCombat() { return !!this.self?.combat; }

  // living hostile mobs the snapshot can see
  hostiles() {
    return [...this.ents.values()].filter((e) => e.k === 'mob' && !e.dead && e.h);
  }
}

// hunter range band: ranged weapon is 8..35 yd (an 8yd deadzone up close)
const DEADZONE = 8, PULL_MAX = 33, IDEAL = 22;
const FLEE_HP = 0.28;          // disengage below this
const RESUME_HP = 0.55;        // stop fleeing once recovered
const ASPECT_EVERY_MS = 45_000;

async function main() {
  const h = new Hunter();
  await h.login();
  await h.connect();
  // settle a couple of snapshots
  await sleep(800);

  const start = Date.now();
  let lastAspect = 0;
  let lastStatus = 0;
  let lastTargetId = null;     // for one-shot Serpent Sting per target
  let stung = false;
  let fleeing = false;
  let kills = 0;
  const lootQueue = new Map(); // corpseId -> {x,z,tries}
  let wanderAngle = 0;

  const stop = () => h.input({});

  while (Date.now() - start < RUN_SECONDS * 1000) {
    if (!h.self) { await sleep(200); continue; }
    const me = h.self;
    const lvl = me.lv ?? 1;
    const offGcd = (me.gcd ?? 0) <= 0 && !me.cast;

    // ---- drain events: count kills, queue corpses for looting ----
    for (const ev of h.events) {
      if (ev.type === 'death') {
        const ent = h.ents.get(ev.entityId);
        if (ent && ent.k === 'mob') {
          lootQueue.set(ev.entityId, { x: ent.x, z: ent.z, tries: 0 });
          if (ev.entityId === me.target || ev.killer === h.pid) kills++;
        }
      }
    }
    h.events = [];

    // ---- death: on a real realm, don't attempt a blind corpse run ----
    if (me.dead) {
      log(`${h.name} died (level ${lvl}, ${kills} kills this run). Releasing and stopping — take over manually.`);
      h.cmd({ cmd: 'release' });
      await sleep(500);
      break;
    }

    // ---- status line every 15s ----
    if (Date.now() - lastStatus > 15_000) {
      lastStatus = Date.now();
      log(`L${lvl} hp ${me.hp}/${me.mhp} mana ${Math.round(me.res ?? 0)}/${me.mres ?? 0} ` +
        `xp ${me.xp ?? 0}/${me.lxp ?? '?'} kills ${kills} ${h.inCombat() ? '[combat]' : ''}${fleeing ? '[fleeing]' : ''}`);
    }

    // ---- keep Aspect of the Hawk up (ranged attack power) ----
    if (lvl >= 4 && offGcd && Date.now() - lastAspect > ASPECT_EVERY_MS) {
      h.cmd({ cmd: 'cast', ability: 'aspect_of_the_hawk' });
      lastAspect = Date.now();
      await sleep(150);
    }

    // ---- survival: flee when low, until recovered ----
    if (h.hpFrac() < FLEE_HP) fleeing = true;
    if (fleeing && h.hpFrac() > RESUME_HP && !h.inCombat()) fleeing = false;
    if (fleeing) {
      h.cmd({ cmd: 'stopattack' });
      const threat = h.hostiles().sort((a, b) => h.dist(a) - h.dist(b))[0];
      if (threat) {
        const away = h.faceTo(threat) + Math.PI; // run directly away
        h.input({ f: 1 }, Math.atan2(Math.sin(away), Math.cos(away)));
      } else {
        stop(); // safe — sit and regen
      }
      await sleep(200);
      continue;
    }

    // ---- pick a target: nearest living hostile that isn't badly over our level ----
    const target = h.hostiles()
      .filter((m) => (m.lv ?? lvl) - lvl <= 3 && h.dist(m) < 60)
      .sort((a, b) => h.dist(a) - h.dist(b))[0];

    if (target) {
      if (target.id !== lastTargetId) { lastTargetId = target.id; stung = false; }
      const d = h.dist(target);
      const facing = h.faceTo(target);

      if (d > PULL_MAX) {
        // close the gap
        h.input({ f: 1 }, facing);
      } else if (d < DEADZONE) {
        // inside the deadzone: melee with Raptor Strike, back-pedal to reopen range
        if (me.target !== target.id) h.cmd({ cmd: 'target', id: target.id });
        h.cmd({ cmd: 'attack' });
        if (offGcd) h.cmd({ cmd: 'cast', ability: 'raptor_strike' });
        h.input({ b: 1 }, facing);
      } else {
        // ideal band: stand, auto-shoot, weave shots
        h.input({}, facing);
        if (me.target !== target.id) h.cmd({ cmd: 'target', id: target.id });
        h.cmd({ cmd: 'attack' }); // auto-shot
        if (offGcd) {
          if (lvl >= 4 && !stung && (me.res ?? 0) >= 15) { h.cmd({ cmd: 'cast', ability: 'serpent_sting' }); stung = true; }
          else if (lvl >= 6 && (me.res ?? 0) >= 25) { h.cmd({ cmd: 'cast', ability: 'arcane_shot' }); }
        }
      }
      await sleep(200);
      continue;
    }

    // ---- nothing to fight: loot a nearby corpse if we have one queued ----
    const corpse = [...lootQueue.entries()].sort((a, b) => h.dist(a[1]) - h.dist(b[1]))[0];
    if (corpse) {
      const [id, c] = corpse;
      const d = h.dist(c);
      if (c.tries > 25 || d > 80) { lootQueue.delete(id); continue; } // gave up / out of reach
      if (d > 4) {
        h.input({ f: 1 }, h.faceTo(c));
      } else {
        stop();
        h.cmd({ cmd: 'loot', id });
        h.cmd({ cmd: 'interact' });
        lootQueue.delete(id);
      }
      c.tries++;
      await sleep(200);
      continue;
    }

    // ---- rest if hurt/low mana, otherwise wander gently to find mobs ----
    if (h.hpFrac() < 0.85 || h.manaFrac() < 0.4) {
      stop(); // out-of-combat regen
      await sleep(400);
      continue;
    }
    // gentle wander: drift in a slowly-rotating direction to pull nearby camps
    wanderAngle += 0.6;
    h.input({ f: 1 }, Math.atan2(Math.sin(wanderAngle), Math.cos(wanderAngle)));
    await sleep(500);
    stop();
    await sleep(200);
  }

  log(`run complete: level ${h.self?.lv ?? '?'}, ${kills} kills. disconnecting.`);
  h.cmd({ cmd: 'stopattack' });
  await sleep(300);
  try { h.ws.close(); } catch {}
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal:', err.message);
  process.exit(1);
});
