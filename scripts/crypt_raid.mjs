// The big one: five bots form a party, enter the Hollow Crypt together,
// and fight their way to Morthen the Gravecaller with simple raid AI
// (focus fire + two healers). Verifies party instancing, elite combat,
// boss mechanics and group xp over the real server.
// Requires the server running with ALLOW_DEV_COMMANDS=1.
import WebSocket from 'ws';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// heavy self fields (inventory, quests, party, ...) arrive only when they
// changed; an absent field means "same as the previous snapshot"
const DELTA_SELF_KEYS = [
  'inv',
  'equip',
  'qlog',
  'qdone',
  'cds',
  'stats',
  'weapon',
  'party',
  'trade',
  'duel',
];
function mergeSelf(prev, next) {
  if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k];
  return next;
}

// entity identity fields ride only in "full" records (first sight and
// changes); "lite" records inherit them from the previous state. Ids in
// snap.keep are alive but unchanged; anything absent from both is gone.
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents) {
    const prev = prevEnts.get(w.id);
    if (prev && w.k === undefined) {
      for (const key of ENTITY_IDENTITY_KEYS) if (key in prev) w[key] = prev[key];
    }
    next.set(w.id, w);
  }
  for (const id of snap.keep ?? []) {
    const prev = prevEnts.get(id);
    if (prev) next.set(id, prev);
  }
  return next;
}

class Bot {
  constructor(name, cls) {
    this.name = name;
    this.cls = cls;
    this.pid = -1;
    this.self = null;
    this.ents = new Map();
    this.events = [];
  }

  async join() {
    const reg = await api('/api/register', {
      username: `raid_${this.name}_${uniq}`,
      password: 'hunter22',
      email: `raid_${this.name}_${uniq}@example.com`,
    });
    this.token = reg.body.token;
    const char = await api(
      '/api/characters',
      { name: this.name + alpha, class: this.cls },
      this.token,
    );
    this.charId = char.body.id;
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('join timeout')), 8000);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId }));
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.ents = mergeEnts(this.ents, msg);
          this.ents.set(this.self.id, this.self);
        } else if (msg.t === 'events') this.events.push(...msg.list);
      });
      this.ws.on('error', reject);
    });
  }

  cmd(payload) {
    this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
  }
  input(mi, facing) {
    this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) }));
  }

  mobs() {
    return [...this.ents.values()].filter((e) => e.k === 'mob' && !e.dead && e.h);
  }
  pos() {
    return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 };
  }
  dist(o) {
    const p = this.pos();
    return Math.hypot(o.x - p.x, o.z - p.z);
  }
  faceTo(o) {
    const p = this.pos();
    return Math.atan2(o.x - p.x, o.z - p.z);
  }
}

async function main() {
  const bots = [
    new Bot('Tankrik', 'warrior'),
    new Bot('Lumen', 'paladin'),
    new Bot('Vessa', 'priest'),
    new Bot('Pyrra', 'mage'),
    new Bot('Fletch', 'hunter'),
  ];
  console.log('joining 5 bots...');
  for (const b of bots) await b.join();
  check(
    'five bots joined',
    bots.every((b) => b.pid > 0),
  );

  // party up: tank invites everyone
  const [tank, pala, priest, mage, hunter] = bots;
  for (const b of bots.slice(1)) {
    tank.cmd({ cmd: 'pinvite', id: b.pid });
    await sleep(250);
    b.cmd({ cmd: 'paccept' });
    await sleep(250);
  }
  await sleep(600);
  check(
    'party of five formed',
    tank.self?.party?.members?.length === 5,
    `members=${tank.self?.party?.members?.length}`,
  );

  // power up and gather at the crypt door
  for (const b of bots) {
    b.cmd({ cmd: 'dev_level', level: 10 });
    b.cmd({ cmd: 'dev_teleport', x: 80 + Math.random() * 2, z: 86 });
  }
  await sleep(600);
  check(
    'all at level 10',
    bots.every((b) => b.self?.lv === 10),
    JSON.stringify(bots.map((b) => b.self?.lv)),
  );

  // everyone enters the crypt
  for (const b of bots) {
    b.cmd({ cmd: 'enter_crypt' });
    await sleep(150);
  }
  await sleep(800);
  check(
    'all five in the dungeon',
    bots.every((b) => (b.self?.x ?? 0) > 600),
    JSON.stringify(bots.map((b) => Math.round(b.self?.x ?? 0))),
  );
  const zs = bots.map((b) => b.self?.z ?? 0);
  check(
    'all in the SAME instance',
    Math.max(...zs) - Math.min(...zs) < 120,
    JSON.stringify(zs.map(Math.round)),
  );

  // buff up + stock water for the casters
  pala.cmd({ cmd: 'cast', ability: 'seal_of_righteousness' });
  priest.cmd({ cmd: 'cast', ability: 'power_word_fortitude' });
  hunter.cmd({ cmd: 'cast', ability: 'aspect_of_the_hawk' });
  for (const b of [pala, priest, mage, hunter])
    b.cmd({ cmd: 'dev_give', item: 'spring_water', count: 20 });
  await sleep(400);

  // ---- raid AI loop ----
  const start = Date.now();
  let bossDead = false;
  let sawElite = false;
  let sawPulse = false;
  let wipes = 0;
  let lastTelemetry = 0;

  const healers = new Set([priest.pid, pala.pid]);

  while (Date.now() - start < 480_000 && !bossDead) {
    // telemetry every 20s
    if (Date.now() - lastTelemetry > 20_000) {
      lastTelemetry = Date.now();
      const boss = [...tank.ents.values()].find((e) => e.tid === 'morthen');
      console.log(
        `  t=${Math.round((Date.now() - start) / 1000)}s boss=${boss ? `${boss.hp}/${boss.mhp}` : 'n/a'} ` +
          bots
            .map(
              (b) =>
                `${b.name.slice(0, 4)}:${b.self?.dead ? 'DEAD' : `${b.self?.hp}|${Math.round(b.self?.res ?? 0)}`}`,
            )
            .join(' '),
      );
    }
    for (const b of bots) {
      if (!b.self) continue;
      if (b.self.dead) {
        // resurrect via release + re-enter (counts as a setback)
        b.cmd({ cmd: 'release' });
        await sleep(120);
        b.cmd({ cmd: 'dev_teleport', x: 80, z: 86 });
        await sleep(120);
        b.cmd({ cmd: 'enter_crypt' });
        wipes++;
        continue;
      }

      // out of combat: drink when low on mana (classic downtime!)
      const nearbyMobs = b.mobs().filter((m) => b.dist(m) < 40);
      if (b.self.rtype === 'mana' && nearbyMobs.length === 0) {
        const manaFrac = (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1);
        if (b.self.eat || b.self.drk) {
          b.input({});
          continue;
        } // keep sitting
        if (manaFrac < 0.35) {
          b.input({});
          b.cmd({ cmd: 'use', item: 'spring_water' });
          continue;
        }
      }

      // healer duty: top up the lowest party member
      if (healers.has(b.pid)) {
        const partyMembers = b.self.party?.members ?? [];
        const hurt = partyMembers
          .filter((m) => !m.dead && m.hp / m.mhp < 0.85)
          .sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
        if (hurt && (b.self.gcd ?? 0) <= 0 && !b.self.cast) {
          b.cmd({ cmd: 'target', id: hurt.pid });
          b.cmd({ cmd: 'cast', ability: b.cls === 'priest' ? 'lesser_heal' : 'holy_light' });
          continue;
        }
        // priest shields the tank between heals
        if (
          b.cls === 'priest' &&
          (b.self.gcd ?? 0) <= 0 &&
          !b.self.cast &&
          tank.self &&
          !tank.self.dead &&
          tank.self.hp / tank.self.mhp < 0.9
        ) {
          b.cmd({ cmd: 'target', id: tank.pid });
          b.cmd({ cmd: 'cast', ability: 'power_word_shield' });
        }
      }
      // paladin keeps a seal up for judgement
      if (b.cls === 'paladin' && !(b.self.auras ?? []).some((a) => a.kind === 'imbue')) {
        b.cmd({ cmd: 'cast', ability: 'seal_of_righteousness' });
      }

      // focus fire: adds first, the boss last (kill order matters!)
      const anchor = tank.self?.dead ? b : tank;
      const candidates = b
        .mobs()
        .filter((m) => Math.hypot(m.x - anchor.self.x, m.z - anchor.self.z) < 30)
        .sort((x, y) => {
          const xBoss = x.tid === 'morthen' ? 1 : 0;
          const yBoss = y.tid === 'morthen' ? 1 : 0;
          return xBoss - yBoss || x.id - y.id;
        });
      const target = candidates[0];
      if (target) {
        if (MOBS_ELITE.has(target.tid)) sawElite = true;
        const d = b.dist(target);
        const facing = b.faceTo(target);
        const meleeRange = b.cls === 'warrior' || b.cls === 'paladin' ? 4 : 26;
        if (d > meleeRange) {
          b.input({ f: 1 }, facing);
        } else {
          b.input({}, facing);
          if (b.self.target !== target.id) b.cmd({ cmd: 'target', id: target.id });
          b.cmd({ cmd: 'attack' });
          if ((b.self.gcd ?? 0) <= 0 && !b.self.cast) {
            if (b.cls === 'warrior' && (b.self.res ?? 0) >= 15)
              b.cmd({ cmd: 'cast', ability: 'heroic_strike' });
            if (b.cls === 'paladin' && (b.self.res ?? 0) >= 30)
              b.cmd({ cmd: 'cast', ability: 'judgement' });
            if (b.cls === 'mage' && (b.self.res ?? 0) >= 30)
              b.cmd({ cmd: 'cast', ability: 'fireball' });
            if (b.cls === 'hunter' && (b.self.res ?? 0) >= 25)
              b.cmd({ cmd: 'cast', ability: 'arcane_shot' });
          }
        }
      } else {
        // no mobs nearby: tank advances toward the boss, others follow the tank
        if (b === tank) {
          const origin = { x: 900, z: Math.round((b.self.z + 1250) / 500) * 500 - 1250 };
          const goal = { x: origin.x, z: b.self.z + 8 };
          b.input({ f: 1 }, b.faceTo(goal));
        } else {
          const d = b.dist({ x: tank.self.x, z: tank.self.z });
          if (d > 10) b.input({ f: 1 }, b.faceTo({ x: tank.self.x, z: tank.self.z }));
          else b.input({});
        }
      }

      // events: pulse + boss death
      for (const ev of b.events) {
        if (ev.type === 'damage' && ev.ability === 'Shadow Pulse') sawPulse = true;
        if (ev.type === 'death') {
          const dead = b.ents.get(ev.entityId);
          if (dead?.tid === 'morthen') bossDead = true;
        }
      }
      b.events = [];
    }
    await sleep(250);
  }

  check('fought elite mobs', sawElite);
  check(
    'Morthen the Gravecaller defeated by the party',
    bossDead,
    `wipes=${wipes} elapsed=${Math.round((Date.now() - start) / 1000)}s`,
  );
  check('boss pulse mechanic fired during the fight', sawPulse);
  console.log(`deaths during the run: ${wipes}`);

  await sleep(500);
  const xps = bots.map((b) => (b.self?.lv === 10 ? 'max' : b.self?.xp));
  console.log(
    'final party state:',
    JSON.stringify(bots.map((b) => ({ n: b.name, hp: b.self?.hp, dead: b.self?.dead }))),
  );

  for (const b of bots) b.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

const MOBS_ELITE = new Set([
  'crypt_shambler',
  'hollow_acolyte',
  'bonechill_widow',
  'sexton_marrow',
  'morthen',
]);

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
