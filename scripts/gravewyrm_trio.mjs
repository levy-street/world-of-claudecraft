// A trio — warrior (tank), hunter (dps), priest (healer) — at level 20, kitted in
// Gravewyrm-tier epics, forms a party, enters Gravewyrm Sanctum, and fights through
// its three chambers to kill Korgath the Bound, Grand Necromancer Velkhar, and
// finally Korzul the Gravewyrm. The Sanctum is tuned for 5; three bots make it with
// the holy trinity, best-in-slot gear, and potions.
// Requires the server running with ALLOW_DEV_COMMANDS=1  (npm run server).
//   node scripts/gravewyrm_trio.mjs
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT_MS = Number(process.env.RAID_TIMEOUT_MS ?? 1_200_000); // 20 min

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`OK   ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DELTA_SELF_KEYS = ['inv', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'weapon', 'party', 'trade', 'duel'];
function mergeSelf(prev, next) { if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k]; return next; }
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents) {
    const prev = prevEnts.get(w.id);
    if (prev && w.k === undefined) for (const key of ENTITY_IDENTITY_KEYS) if (key in prev) w[key] = prev[key];
    next.set(w.id, w);
  }
  for (const id of snap.keep ?? []) { const prev = prevEnts.get(id); if (prev) next.set(id, prev); }
  return next;
}

// Best-in-slot Gravewyrm-tier kit (requiredClass-matched).
const GEAR = {
  warrior: ['wyrmfang_greatblade', 'deathlord_warplate', 'deathlord_legguards', 'deathlord_sabatons',
    'crownforged_dreadhelm', 'crownforged_warspaulders', 'gravewyrm_gauntlets', 'boundstone_girdle'],
  hunter: ['fang_of_korzul', 'wyrmshadow_harness', 'wyrmshadow_legguards', 'wyrmshadow_treads',
    'wyrmshadow_talongrips', 'nighttalon_crown', 'nighttalon_shoulderguards'],
  priest: ['staff_of_the_gravewyrm', 'necromancers_starshroud', 'necromancers_soulsteps',
    'soulflame_cowl', 'soulflame_mantle'],
};

class Bot {
  constructor(name, cls) { this.name = name; this.cls = cls; this.pid = -1; this.self = null; this.ents = new Map(); this.events = []; this.lock = null; }
  async join() {
    const reg = await api('/api/register', { username: `gw_${this.name}_${uniq}`, password: 'hunter22' });
    this.token = reg.body.token;
    const char = await api('/api/characters', { name: this.name + alpha, class: this.cls }, this.token);
    this.charId = char.body.id;
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('join timeout')), 8000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })));
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') { this.pid = msg.pid; clearTimeout(to); resolve(); }
        else if (msg.t === 'snap') { this.self = mergeSelf(this.self, msg.self); this.ents = mergeEnts(this.ents, msg); this.ents.set(this.self.id, this.self); }
        else if (msg.t === 'events') this.events.push(...msg.list);
      });
      this.ws.on('error', reject);
    });
  }
  cmd(p) { this.ws.send(JSON.stringify({ t: 'cmd', ...p })); }
  input(mi, facing) { this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) })); }
  pos() { return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 }; }
  dist(o) { const p = this.pos(); return Math.hypot(o.x - p.x, o.z - p.z); }
  faceTo(o) { const p = this.pos(); return Math.atan2(o.x - p.x, o.z - p.z); }
  mobs() { return [...this.ents.values()].filter((e) => e.k === 'mob' && !e.dead && e.h); }
  nearestMob() { return this.mobs().sort((a, b) => this.dist(a) - this.dist(b))[0]; }
  hpFrac() { return (this.self?.hp ?? 1) / Math.max(1, this.self?.mhp ?? 1); }
}

const BOSSES = new Set(['korgath_the_bound', 'grand_necromancer_velkhar', 'korzul_the_gravewyrm']);
const FINALE = 'korzul_the_gravewyrm';

async function main() {
  const tank = new Bot('Grimbol', 'warrior');
  const hunter = new Bot('Kessa', 'hunter');
  const priest = new Bot('Sael', 'priest');
  const bots = [tank, hunter, priest];

  console.log('joining trio...');
  for (const b of bots) await b.join();
  check('trio joined', bots.every((b) => b.pid > 0));

  for (const b of [hunter, priest]) { tank.cmd({ cmd: 'pinvite', id: b.pid }); await sleep(250); b.cmd({ cmd: 'paccept' }); await sleep(250); }
  await sleep(600);
  check('party of three formed', tank.self?.party?.members?.length === 3, `members=${tank.self?.party?.members?.length}`);

  // level 20, kit out in epics, stock potions, gather at the Sanctum gate (doorPos 0,880)
  for (const b of bots) {
    b.cmd({ cmd: 'dev_level', level: 20 });
    b.cmd({ cmd: 'dev_teleport', x: -1 + Math.random() * 2, z: 878 });
    b.cmd({ cmd: 'dev_give', item: 'healing_potion', count: 30 });
    for (const item of GEAR[b.cls]) { b.cmd({ cmd: 'dev_give', item, count: 1 }); }
  }
  await sleep(500);
  for (const b of bots) for (const item of GEAR[b.cls]) { b.cmd({ cmd: 'equip', item }); await sleep(40); }
  for (const b of [hunter, priest]) { b.cmd({ cmd: 'dev_give', item: 'mana_potion', count: 30 }); b.cmd({ cmd: 'dev_give', item: 'spring_water', count: 60 }); }
  await sleep(800);
  check('all at level 20', bots.every((b) => b.self?.lv === 20), JSON.stringify(bots.map((b) => b.self?.lv)));
  console.log('gear/hp:', JSON.stringify(bots.map((b) => ({ n: b.name, hp: b.self?.mhp, equipped: Object.keys(b.self?.equip ?? {}).length }))));

  for (const b of bots) { b.cmd({ cmd: 'enter_dungeon', dungeon: 'gravewyrm_sanctum' }); await sleep(180); }
  await sleep(900);
  const xs = bots.map((b) => Math.round(b.self?.x ?? 0));
  check('trio left the overworld into the instance', bots.every((b) => Math.abs(b.self?.x ?? 0) > 300), JSON.stringify(xs));
  check('all in the SAME instance', Math.max(...xs) - Math.min(...xs) < 200, JSON.stringify(xs));

  priest.cmd({ cmd: 'cast', ability: 'power_word_fortitude' });
  hunter.cmd({ cmd: 'cast', ability: 'aspect_of_the_hawk' });
  tank.cmd({ cmd: 'cast', ability: 'battle_shout' });
  tank.cmd({ cmd: 'cast', ability: 'defensive_stance' });
  await sleep(400);

  const start = Date.now();
  const killed = new Set();
  let wipes = 0, lastTel = 0, finaleDead = false;
  const gcdReady = (b) => (b.self.gcd ?? 0) <= 0 && !b.self.cast;
  const ENGAGE = 42; // a mob within this range = "in the fight"

  while (Date.now() - start < TIMEOUT_MS && !finaleDead) {
    if (Date.now() - lastTel > 15_000) {
      lastTel = Date.now();
      const liveBoss = (id) => [...tank.ents.values()].find((e) => e.tid === id && !e.dead);
      const bossStr = (id) => killed.has(id) ? 'dead' : (liveBoss(id) ? `${liveBoss(id).hp}/${liveBoss(id).mhp}` : '-');
      console.log(`  t=${Math.round((Date.now() - start) / 1000)}s z=${Math.round(tank.self?.z ?? 0)} ` +
        `Korgath:${bossStr('korgath_the_bound')} Velkhar:${bossStr('grand_necromancer_velkhar')} Korzul:${bossStr(FINALE)} | ` +
        bots.map((b) => `${b.name.slice(0, 4)}:${b.self?.dead ? 'DEAD' : `${b.self?.hp}|${Math.round(b.self?.res ?? 0)}`}`).join(' '));
    }

    // GROUP FOCUS: the tank LOCKS one mob and holds it until it dies, so everyone
    // burns the same target down instead of thrashing between mobs (which kills nothing).
    let lockMob = tank.lock != null ? tank.ents.get(tank.lock) : null;
    if (!lockMob || lockMob.dead || lockMob.k !== 'mob' || !lockMob.h) { lockMob = tank.nearestMob(); tank.lock = lockMob ? lockMob.id : null; }
    const focusId = lockMob ? lockMob.id : null;

    // Classic dungeon pacing: between packs, if the healer is low and nothing is
    // attacking, the whole group HOLDS and drinks back to mana before the next pull.
    const tankEngaged = tank.mobs().some((m) => tank.dist(m) < ENGAGE);
    const priestMana = (priest.self?.res ?? 0) / Math.max(1, priest.self?.mres ?? 1);
    const resting = !tankEngaged && priestMana < 0.65 && bots.every((b) => b.self && !b.self.dead);

    for (const b of bots) {
      if (!b.self) continue;

      if (b.self.dead) {
        b.cmd({ cmd: 'release' }); await sleep(80);
        b.cmd({ cmd: 'dev_teleport', x: 0, z: 878 }); await sleep(80);
        b.cmd({ cmd: 'enter_dungeon', dungeon: 'gravewyrm_sanctum' });
        if (b === tank) wipes++;
        continue;
      }
      if (b.hpFrac() < 0.4) b.cmd({ cmd: 'use', item: 'healing_potion' });
      if (b.self.rtype === 'mana' && (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1) < 0.25) b.cmd({ cmd: 'use', item: 'mana_potion' });

      // rest/drink between pulls
      if (resting) {
        if (b.self.rtype === 'mana' && (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1) < 0.92) { b.input({}); if (!b.self.drk && !b.self.eat) b.cmd({ cmd: 'use', item: 'spring_water' }); }
        else b.input({});
        continue;
      }

      const nearMobs = b.mobs().filter((m) => b.dist(m) < 45);
      if (b.self.rtype === 'mana' && nearMobs.length === 0) {
        if (b.self.eat || b.self.drk) { b.input({}); continue; }
        if ((b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1) < 0.45) { b.input({}); b.cmd({ cmd: 'use', item: 'spring_water' }); continue; }
      }

      // -------- PRIEST: glue to tank, keep everyone up, chip in --------
      if (b.cls === 'priest') {
        const members = b.self.party?.members ?? [];
        const t = tank.self;
        const dTank = b.dist({ x: tank.self.x, z: tank.self.z });
        if (dTank > 20) b.input({ f: 1 }, b.faceTo({ x: tank.self.x, z: tank.self.z })); else b.input({});
        if (gcdReady(b)) {
          // emergency: anyone critically low -> big heal
          const crit = members.filter((m) => !m.dead && m.hp / m.mhp < 0.45).sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
          if (crit) { b.cmd({ cmd: 'target', id: crit.pid }); b.cmd({ cmd: 'cast', ability: 'heal' }); continue; }
          // backbone: keep the tank shielded + renewed (cheap, mana-efficient)
          if (t && !t.dead && (t.auras ?? []).every((a) => a.id !== 'power_word_shield')) { b.cmd({ cmd: 'target', id: tank.pid }); b.cmd({ cmd: 'cast', ability: 'power_word_shield' }); continue; }
          const hurt = members.filter((m) => !m.dead && m.hp / m.mhp < 0.72).sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
          if (hurt) { b.cmd({ cmd: 'target', id: hurt.pid }); b.cmd({ cmd: 'cast', ability: 'flash_heal' }); continue; }
          if (t && !t.dead && (t.auras ?? []).every((a) => a.id !== 'renew')) { b.cmd({ cmd: 'target', id: tank.pid }); b.cmd({ cmd: 'cast', ability: 'renew' }); continue; }
          // only chip the boss when there's mana to spare
          if (priestMana > 0.55 && focusId && b.dist(b.ents.get(focusId)) < 30) { b.cmd({ cmd: 'target', id: focusId }); b.cmd({ cmd: 'cast', ability: 'smite' }); }
        }
        continue;
      }

      // -------- WARRIOR: pull one pack at a time, AoE threat, hold ground --------
      if (b.cls === 'warrior') {
        const m = lockMob; // commit to the locked target until it dies
        if (m) {
          const d = b.dist(m), facing = b.faceTo(m);
          if (d > 4) { b.input({ f: 1 }, facing); }
          else {
            b.input({}, facing);
            if (b.self.target !== m.id) b.cmd({ cmd: 'target', id: m.id });
            b.cmd({ cmd: 'attack' });
            if ((b.self.res ?? 0) < 10) b.cmd({ cmd: 'cast', ability: 'bloodrage' });
            if (gcdReady(b)) {
              if (nearMobs.length >= 2 && (b.self.res ?? 0) >= 20) b.cmd({ cmd: 'cast', ability: 'thunder_clap' });
              else if ((b.self.res ?? 0) >= 15) b.cmd({ cmd: 'cast', ability: 'sunder_armor' });
            } else if ((b.self.res ?? 0) >= 35) b.cmd({ cmd: 'cast', ability: nearMobs.length >= 2 ? 'cleave' : 'heroic_strike' });
          }
        } else { b.input({}); }
        continue;
      }

      // -------- HUNTER: focus the tank's target from range, stay back --------
      if (b.cls === 'hunter') {
        const tgt = focusId ? b.ents.get(focusId) : b.nearestMob();
        const tankEngaged = tank.self && (tank.self.res ?? 0) > 0;
        if (tgt && tankEngaged) {
          const d = b.dist(tgt), facing = b.faceTo(tgt);
          if (d > 28) b.input({ f: 1 }, facing);
          else if (d < 8) b.input({ b: 1 }, facing);
          else {
            b.input({}, facing);
            if (b.self.target !== tgt.id) b.cmd({ cmd: 'target', id: tgt.id });
            b.cmd({ cmd: 'attack' });
            if (gcdReady(b)) {
              if (!(tgt.auras ?? []).some((a) => a.id === 'serpent_sting')) b.cmd({ cmd: 'cast', ability: 'serpent_sting' });
              else if ((b.self.res ?? 0) >= 25) b.cmd({ cmd: 'cast', ability: 'arcane_shot' });
            }
          }
        } else {
          const d = b.dist({ x: tank.self.x, z: tank.self.z });
          if (d > 14) b.input({ f: 1 }, b.faceTo({ x: tank.self.x, z: tank.self.z })); else b.input({});
        }
        continue;
      }
    }

    for (const b of bots) {
      for (const ev of b.events) {
        if (ev.type === 'death') {
          const dead = b.ents.get(ev.entityId);
          if (dead && BOSSES.has(dead.tid) && !killed.has(dead.tid)) {
            killed.add(dead.tid);
            console.log(`  >>> ${dead.nm ?? dead.tid} SLAIN (t=${Math.round((Date.now() - start) / 1000)}s)`);
            if (dead.tid === FINALE) finaleDead = true;
          }
        }
      }
      b.events = [];
    }
    await sleep(220);
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  check('Korgath the Bound defeated', killed.has('korgath_the_bound'));
  check('Grand Necromancer Velkhar defeated', killed.has('grand_necromancer_velkhar'));
  check('Korzul the Gravewyrm defeated — SANCTUM CLEARED', finaleDead, `bosses=${[...killed].length}/3 wipes=${wipes} elapsed=${elapsed}s`);
  console.log(`\nbosses down: ${[...killed].join(', ') || 'none'} | wipes: ${wipes} | elapsed: ${elapsed}s`);

  for (const b of bots) b.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
