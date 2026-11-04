// The shared plumbing of the Smith's Heart raid bots (scripts/heart_raid.mjs):
// ten scripted players over the real REST + world socket (scripts/lib/world_bot.mjs)
// log in, level and gear to the raid's level with dev commands, form ONE raid
// group, step into the Smith's Heart and walk to a boss; then a generic raid
// (tanks, healers, damage dealers, interrupters) fights it while a boss module
// (scripts/lib/heart_raid_<boss>.mjs) adds only that boss's mechanic AI
// through a small set of hooks. Everything the raid knows comes from what the
// server sends (snapshots and events). The run is written up as a fight log.
//
// DEV ONLY: needs a server started with ALLOW_DEV_COMMANDS=1 (never production).
//
// A boss module exports one object:
//   key, title             'breath', 'Guardian of the Breath'
//   tids                   { role: template id } of the boss bodies (role[0] the main tank's)
//   setup(diff)            dev lines the leader sends after entering (tier switch, cleanup)
//   tp                     the dev line every bot sends to reach the arena
//   locate(world)          true once the arena is known (sets world.center, home, anchor,
//                          floor, tankSpot, prepull); called every read until it succeeds
//   read?(world)           per-read extra state (objects of the fight)
//   track?(world, st)      snapshot diffs worth logging (marks, casts, objects)
//   plan?(world, st)       the raid's plan for this tick (who goes where)
//   duty?(world,st,b,me)   { goal, tol, duty, hold? } a bot's mechanic move, or null
//   hazards?(world,st,b,me) circles {x,z,r} a bot keeps out of on its role spot
//   bad?(world, st, at)    true when a spot is unsafe (extra to the hazards)
//   obstacles?(world)      circles a walking bot goes round
//   blocksLine?(world,a,b) true when no line of sight (pillars)
//   stillFor?(world,st,b)  seconds the bot may stand still to cast
//   tankAssign?(world,st,b,me) sets b.tankTarget (a role or an entity id) and b.loose
//   targets?(world,st,b)   the entity a damage dealer hits
//   kickables?(world)      [{ mob, cast }] kickable bars now
//   result?(world, st)     'kill' | 'wipe' | 'reset' | null (default: every body down)
//   report?(world, st, note) extra summary lines; row?(world, st) extra table cells

import fs from 'node:fs';
import path from 'node:path';
import { steer } from './heart_council_tactics.mjs';
import { WorldBot } from './world_bot.mjs';

// ---- configuration ------------------------------------------------------------------

export const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
export const DIFF = (process.env.DIFF ?? 'normal').toLowerCase();
if (!['normal', 'heroic', 'mythic'].includes(DIFF)) throw new Error(`DIFF: ${DIFF}`);
export const JOIN = (process.env.JOIN ?? '').trim();
export const JOIN_ROLE = (process.env.JOIN_ROLE ?? 'dps').toLowerCase();
export const GEAR = (process.env.GEAR ?? 'kit').toLowerCase();
export const KICK_MISS = Number(process.env.KICK_MISS ?? 0.15);
export const MAX_SECONDS = Number(process.env.MAX_SECONDS ?? 720);
export const LOG_DIR = process.env.LOG_DIR ?? 'tmp/heart_raid';
/** A key mechanic the raid ignores on purpose (the proof that it matters). */
export const IGNORE = (process.env.IGNORE ?? '').toLowerCase();
export const HEROIC_PLUS = DIFF !== 'normal';
let seed = Number(process.env.SEED ?? Date.now()) >>> 0;
/** mulberry32: the script's own rolls (kick fumbles, reaction times, slips). */
export function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const liveBots = [];

// ---- geometry helpers -----------------------------------------------------------------

export const hypot = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const unit = (from, to) => {
  const d = hypot(from, to) || 1;
  return { x: (to.x - from.x) / d, z: (to.z - from.z) / d };
};
export const add = (a, v, k = 1) => ({ x: a.x + v.x * k, z: a.z + v.z * k });
export const perp = (v) => ({ x: -v.z, z: v.x });
export const hasAura = (e, id) => !!e?.auras?.some((a) => a.id === id);
export const auraOf = (e, id) => e?.auras?.find((a) => a.id === id) ?? null;
export const pct = (n) => `${Math.round(n * 100)}%`;
export const alive = (m) => !!m && !m.dead && (m.hp ?? 0) > 0;
export const dirOf = (deg) => ({
  x: Math.sin((deg * Math.PI) / 180),
  z: Math.cos((deg * Math.PI) / 180),
});
/** Distance from p to the segment a-b (xz). */
export function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

// ---- the raid -------------------------------------------------------------------------

export const CAST_TIME = {
  fireball: 1.5,
  scorch: 1.5,
  flash_heal: 1.5,
  heal: 2.5,
  prayer_of_healing: 3,
  chain_heal: 2.5,
  healing_wave: 1.5,
  aimed_shot: 2.5,
  measured_shot: 1.5,
  shadow_bolt: 1.7,
  immolate: 2,
  chaos_bolt: 2.3,
  lightning_bolt: 1.5,
  lava_burst: 2,
  chain_lightning: 2.5,
};

export const COST = {
  fireball: 95,
  scorch: 35,
  combustion: 100,
  fire_blast: 85,
  counterspell: 45,
  flash_heal: 63,
  heal: 91,
  renew: 75,
  power_word_shield: 130,
  prayer_of_healing: 145,
  chain_heal: 48,
  healing_wave: 39,
  tidecall: 40,
  lightning_bolt: 39,
  lava_burst: 70,
  chain_lightning: 80,
  flame_shock: 44,
  shadow_bolt: 62,
  immolate: 46,
  conflagrate: 40,
  spell_lock: 35,
  consecration: 35,
  sunward_disc: 25,
};

const ROTATIONS = {
  prot: (c) =>
    c.pick([
      ['shield_slam', c.dist <= 5],
      ['revenge', c.res >= 20 && c.dist <= 5],
      ['thunder_clap', c.res >= 20 && c.dist <= 6],
      ['sunder_armor', c.res >= 25 && c.dist <= 5],
    ]),
  protection: (c) =>
    c.pick([
      ['holy_shield', true],
      ['vowkeeper_strike', c.dist <= 5],
      ['bastion_sweep', c.dist <= 6],
      ['consecration', c.dist <= 6 && c.manaPct > 0.25],
      ['sunward_disc', c.manaPct > 0.2],
      ['hammer_of_grace', c.dist <= 19],
    ]),
  combat: (c) =>
    c.pick([
      ['adrenaline_rush', c.fightAge > 3],
      ['slice_and_dice', c.combo >= 2 && !c.selfAura('slice_and_dice')],
      ['eviscerate', c.combo >= 5],
      ['sinister_strike', c.res >= 38],
    ]),
  arms: (c) =>
    c.pick([
      ['bloodrage', true],
      ['execute', c.tPct < 0.2 && c.res >= 10],
      ['mortal_strike', c.res >= 30],
      ['overpower', c.res >= 15],
      ['slam', true],
    ]),
  fire: (c) =>
    c.pick([
      ['combustion', c.fightAge > 5],
      ['fire_blast', c.manaPct > 0.2 && c.dist <= 19],
      ['fireball', c.manaPct > 0.06],
      ['scorch', c.manaPct > 0.03],
    ]),
  marksmanship: (c) =>
    c.pick([
      ['serpent_sting', !c.targetAura('serpent_sting') && c.res >= 29],
      ['rapid_fire', true],
      ['arcane_shot', c.res >= 40],
      ['aimed_shot', c.res >= 50],
      ['measured_shot', true],
    ]),
  destruction: (c) =>
    c.pick([
      ['life_tap', c.manaPct < 0.25 && c.hpPct > 0.6],
      ['immolate', !c.targetAura('immolate')],
      ['conflagrate', c.targetAura('immolate')],
      ['shadowburn', c.tPct < 0.2],
      ['shadow_bolt', true],
    ]),
  elemental: (c) =>
    c.pick([
      ['flame_shock', !c.targetAura('flame_shock') && c.dist <= 19],
      ['lava_burst', true],
      ['chain_lightning', c.manaPct > 0.3],
      ['lightning_bolt', true],
    ]),
};
const OFF_GCD = new Set([
  'holy_shield',
  'fire_blast',
  'combustion',
  'bloodrage',
  'adrenaline_rush',
  'taunt',
  'sacred_challenge',
  'pummel',
]);

/** Interrupts: ability, range, cooldown, cost. */
export const KICKS = {
  mage: { id: 'counterspell', range: 29, cd: 24, cost: 0 },
  hunter: { id: 'counter_shot', range: 34, cd: 20, cost: 35 },
  warlock: { id: 'spell_lock', range: 29, cd: 24, cost: 0 },
  rogue: { id: 'kick', range: 4.5, cd: 10, cost: 25 },
  warrior: { id: 'pummel', range: 4.5, cd: 10, cost: 0 },
  paladin: { id: 'hushbrand', range: 4.5, cd: 15, cost: 0 },
};

export const ROSTER = [
  { key: 'mt', role: 'tank', cls: 'warrior', spec: 'prot', name: 'Brannock' },
  { key: 'ot', role: 'tank', cls: 'paladin', spec: 'protection', name: 'Aldwyne' },
  { key: 'h1', role: 'healer', cls: 'priest', spec: 'holy', name: 'Sellith' },
  { key: 'h2', role: 'healer', cls: 'shaman', spec: 'restoration', name: 'Tovaru' },
  { key: 'rogue', role: 'dps', melee: true, cls: 'rogue', spec: 'combat', name: 'Kesrin' },
  { key: 'arms', role: 'dps', melee: true, cls: 'warrior', spec: 'arms', name: 'Hadrek' },
  { key: 'mage', role: 'dps', cls: 'mage', spec: 'fire', name: 'Ivaline' },
  { key: 'hunter', role: 'dps', cls: 'hunter', spec: 'marksmanship', name: 'Fenwick' },
  { key: 'lock', role: 'dps', cls: 'warlock', spec: 'destruction', name: 'Morvane' },
  { key: 'ele', role: 'dps', cls: 'shaman', spec: 'elemental', name: 'Oskari' },
];
const STEP_OUT = { dps: 'ele', healer: 'h2', tank: 'ot' };
const KICK_ORDER = ['mage', 'hunter', 'ot', 'lock', 'rogue', 'arms', 'mt'];

// ---- the fight log ----------------------------------------------------------------------

const T0 = Date.now();
let fightStart = null;
const lines = [];
function fightClock() {
  const s = fightStart === null ? -(Date.now() - T0) / 1000 : (Date.now() - fightStart) / 1000;
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${(a % 60).toFixed(1).padStart(4, '0')}`;
}
export function log(text) {
  const line = `[${fightClock()}] ${text}`;
  lines.push(line);
  console.log(line);
}
export function note(text) {
  lines.push(text);
  console.log(text);
}
export function fightSec() {
  return fightStart === null ? 0 : (Date.now() - fightStart) / 1000;
}
export function fmtSec(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
export function summarize(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => `${k} x${n}`).join(', ');
}

// ---- main ---------------------------------------------------------------------------------

/** Run one boss with the raid; the process exits at the end. */
export async function runRaid(boss) {
  try {
    await raidMain(boss);
  } catch (err) {
    console.error('fatal:', err);
    // Log the bots out cleanly: a dropped socket holds a character in the
    // world for the linkdead grace and blocks the next run.
    for (const b of liveBots) b.close();
    await sleep(500);
    process.exit(1);
  }
}

async function raidMain(boss) {
  const roster = JOIN ? ROSTER.filter((r) => r.key !== STEP_OUT[JOIN_ROLE]) : ROSTER;
  if (JOIN && !STEP_OUT[JOIN_ROLE]) throw new Error(`JOIN_ROLE: ${JOIN_ROLE}`);
  const bots = roster.map((r) =>
    Object.assign(
      new WorldBot({
        base: BASE,
        username: `hcbot_${r.key}`,
        password: 'councilbot22',
        name: r.name,
        cls: r.cls,
        stableTimerWire: r.key === 'lock',
      }),
      { spec: r, kickCd: 0, lastSent: {}, lastTargetCmd: 0, lastAttackCmd: 0, goal: null },
    ),
  );
  liveBots.push(...bots);
  const byKey = Object.fromEntries(bots.map((b) => [b.spec.key, b]));
  console.log(
    `${boss.title} raid: ${DIFF}, ${bots.length} bots${JOIN ? ` + ${JOIN} (${JOIN_ROLE})` : ''}, gear ${GEAR}${IGNORE ? `, IGNORING ${IGNORE}` : ''}`,
  );
  for (const b of bots) {
    await b.login();
    await b.connect();
  }
  console.log(`logged in: ${bots.map((b) => `${b.name}(${b.cls} ${b.spec.spec})`).join(', ')}`);
  await sleep(800);

  for (const b of bots) b.cmd({ cmd: 'pleave' });
  await sleep(400);
  for (const b of bots) {
    b.chat('/dev revive');
    b.cmd({ cmd: 'dev_level', level: 20 });
  }
  await flushAll(bots);
  await sleep(600);
  for (const b of bots) b.cmd({ cmd: 'setSpec', spec: b.spec.spec });
  await sleep(600);
  for (const b of bots)
    b.chat(GEAR === 'bis' ? `/dev bis ${b.spec.spec}` : `/dev kit ${b.spec.spec}`);
  await flushAll(bots);
  await sleep(1200);

  const leader = bots[0];
  const others = bots.slice(1);
  for (const b of others.slice(0, 4)) {
    leader.cmd({ cmd: 'pinvite', id: b.pid });
    await sleep(200);
    b.cmd({ cmd: 'paccept' });
    await sleep(250);
  }
  await sleep(400);
  leader.cmd({ cmd: 'praid' });
  await sleep(500);
  for (const b of others.slice(4)) {
    leader.cmd({ cmd: 'pinvite', id: b.pid });
    await sleep(200);
    b.cmd({ cmd: 'paccept' });
    await sleep(250);
  }
  await sleep(800);
  const party = () => leader.self?.party ?? null;
  if (!party()?.raid || party().members.length !== bots.length)
    throw new Error(`raid not formed: ${JSON.stringify(party())?.slice(0, 300)}`);
  console.log(`raid formed: ${party().members.length} members`);

  if (JOIN) {
    leader.chat(`/invite ${JOIN}`);
    console.log(`\n>>> ${JOIN}: accept the raid invite (sent by ${leader.name}).`);
    const asked = Date.now();
    let lastAsk = Date.now();
    while (!humanMember(leader, JOIN)) {
      if (Date.now() - asked > 15 * 60_000) throw new Error(`${JOIN} never joined the raid`);
      if (Date.now() - lastAsk > 45_000) {
        leader.chat(`/invite ${JOIN}`);
        lastAsk = Date.now();
      }
      drainAll(bots);
      await sleep(500);
    }
    console.log(`${JOIN} is in the raid.`);
  }

  // A fresh run of the Smith's Heart for every boss (no fight state left
  // over from an earlier one), then the boss's own dev setup.
  leader.chat('/dev heart reset');
  await flushAll(bots);
  await sleep(800);
  leader.chat('/dev heart enter');
  await flushAll(bots);
  await sleep(800);
  for (const b of others) b.chat('/dev heart enter');
  await flushAll(bots);
  await sleep(800);
  for (const line of boss.setup(DIFF)) leader.chat(line);
  await flushAll(bots);
  await sleep(600);

  if (JOIN) {
    console.log(
      `\n>>> ${JOIN}: come into the Smith's Heart (type /dev heart enter). The bots wait for you there and follow you to the boss (or type ${boss.tp}).`,
    );
    await waitForHumanInside(bots, leader);
  }
  for (const b of bots) b.chat(boss.tp);
  await flushAll(bots);
  await sleep(2000);
  for (const b of others) for (const ev of b.drainEvents()) heardPull(ev);

  const world = new RaidWorld(bots, leader, boss);
  for (let i = 0; i < 30 && !world.center; i++) {
    world.read();
    if (!world.center) await sleep(200);
  }
  if (!world.center) {
    const seen = [...leader.ents.values()].map((e) => `${e.k}:${e.tid}`);
    throw new Error(
      `${boss.title}: arena not found; leader at ${leader.self?.x?.toFixed(0)},${leader.self?.z?.toFixed(0)}; ${seen.slice(0, 20).join(' ')}`,
    );
  }
  log(`${boss.title}: arena at (${world.center.x.toFixed(1)}, ${world.center.z.toFixed(1)})`);
  if (JOIN) await followHuman(world, bots, leader);
  await prepullBuffs(world, bots, byKey);
  if (JOIN) {
    leader.chat(`/p Ready. ${JOIN}: say "pull" in raid chat, or hit the boss.`);
    console.log(`\n>>> ${JOIN}: say "pull" in raid chat (or attack the boss) to start.`);
    await waitForPullCall(world, bots);
  }
  const st = await fight(world, bots, byKey, boss);
  const report = writeReport(world, st, boss);
  if (JOIN) leader.chat(`/p ${st.result === 'kill' ? 'Boss down.' : 'Wipe.'} Log: ${report}`);
  for (const b of bots) b.stop();
  await sleep(600);
  for (const b of bots) b.close();
  await sleep(300);
  process.exit(0);
}

export async function flushAll(bots) {
  await Promise.all(bots.map((b) => b.chatFlushed()));
}
function drainAll(bots) {
  for (const b of bots) for (const ev of b.drainEvents()) heardPull(ev);
}
let pullCalled = false;
function heardPull(ev) {
  if (
    JOIN &&
    ev.type === 'chat' &&
    ev.from?.toLowerCase() === JOIN.toLowerCase() &&
    /\bpull\b|\bgo\b/i.test(ev.text ?? '')
  )
    pullCalled = true;
}
function humanMember(leader, name) {
  return (
    leader.self?.party?.members?.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null
  );
}
async function waitForHumanInside(bots, leader) {
  const started = Date.now();
  for (;;) {
    const m = humanMember(leader, JOIN);
    if (m && Math.abs(m.x - leader.self.x) < 400 && Math.abs(m.z - leader.self.z) < 300) return;
    if (Date.now() - started > 15 * 60_000) throw new Error(`${JOIN} never came into the Heart`);
    drainAll(bots);
    await sleep(500);
  }
}
/** The bots wait at the arena for the human (who walks or uses the dev tp). */
async function followHuman(world, bots, leader) {
  console.log(`waiting for ${JOIN} at the boss...`);
  let lastNote = 0;
  for (;;) {
    const m = humanMember(leader, JOIN);
    if (m && hypot(m, world.center) < (world.reach ?? 45)) break;
    if (Date.now() - lastNote > 30_000) {
      lastNote = Date.now();
      console.log(`>>> waiting for ${JOIN} at the boss (or ${world.boss.tp})`);
    }
    drainAll(bots);
    await sleep(300);
  }
  console.log(`${JOIN} is here.`);
}
async function waitForPullCall(world, bots) {
  for (;;) {
    drainAll(bots);
    if (pullCalled) return;
    world.read();
    if (world.bodies().some((m) => alive(m) && m.aggro != null)) return;
    await sleep(200);
  }
}

async function prepullBuffs(world, bots, byKey) {
  const self = (b, id) => b.cmd({ cmd: 'cast', ability: id });
  const on = (b, id, pid) => b.cmd({ cmd: 'cast', ability: id, target: pid });
  if (byKey.mt) self(byKey.mt, 'defensive_stance');
  if (byKey.arms) self(byKey.arms, 'battle_stance');
  if (byKey.hunter) self(byKey.hunter, 'aspect_of_the_hawk');
  if (byKey.h2) self(byKey.h2, 'lifespring_weapon');
  if (byKey.ele) self(byKey.ele, 'flametongue_weapon');
  if (byKey.rogue) self(byKey.rogue, 'instant_poison');
  await sleep(1600);
  if (byKey.mage) self(byKey.mage, 'arcane_intellect');
  if (byKey.arms) self(byKey.arms, 'battle_shout');
  if (byKey.lock) self(byKey.lock, 'demon_skin');
  if (byKey.h2) self(byKey.h2, 'lightning_shield');
  const priest = byKey.h1;
  if (priest) {
    for (const m of priest.self?.party?.members ?? []) {
      on(priest, 'power_word_fortitude', m.pid);
      await sleep(1600);
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    world.read();
    let all = true;
    for (const b of bots) if (!world.moveTo(b, world.prepullSpot(b), 1.5)) all = false;
    drainAll(bots);
    if (all) break;
    await sleep(100);
  }
  for (const b of bots) {
    b.stop();
    b.chat('/dev heal');
    b.chat('/dev resource');
  }
  await flushAll(bots);
  await sleep(400);
}

// ---- the world as the raid reads it -----------------------------------------------------

export class RaidWorld {
  constructor(bots, leader, boss) {
    this.bots = bots;
    this.leader = leader;
    this.boss = boss;
    this.roles = Object.keys(boss.tids);
    this.roleOfTid = Object.fromEntries(Object.entries(boss.tids).map(([r, t]) => [t, r]));
    this.mobs = {};
    this.mobIds = new Set();
    this.players = new Map();
    this.pids = new Set();
    this.center = null;
  }
  get obs() {
    return this.leader;
  }
  /** The boss bodies (the roles' entities, alive or not). */
  bodies() {
    return this.roles.map((r) => this.mobs[r]).filter(Boolean);
  }
  /** Every entity the observer sees. */
  ents() {
    return this.obs.ents.values();
  }
  read() {
    const o = this.obs;
    if (!o.self) return;
    this.pids = new Set((o.self.party?.members ?? []).map((m) => m.pid));
    for (const b of this.bots) this.pids.add(b.pid);
    for (const e of o.ents.values()) {
      if (e.k === 'mob' && this.roleOfTid[e.tid]) {
        this.mobs[this.roleOfTid[e.tid]] = e;
        this.mobIds.add(e.id);
      }
    }
    // Hostile mobs in the fight that are no boss (the adds).
    this.adds = [...o.ents.values()].filter(
      (e) => e.k === 'mob' && !this.roleOfTid[e.tid] && alive(e) && e.aggro != null,
    );
    const members = o.self.party?.members ?? [];
    const players = new Map();
    for (const m of members) {
      const ent = o.ents.get(m.pid);
      const bot = this.bots.find((b) => b.pid === m.pid);
      const self = bot?.self;
      players.set(m.pid, {
        pid: m.pid,
        name: m.name,
        cls: m.cls,
        x: self?.x ?? ent?.x ?? m.x,
        z: self?.z ?? ent?.z ?? m.z,
        y: self?.y ?? ent?.y ?? 0,
        hp: self?.hp ?? m.hp,
        mhp: self?.mhp ?? m.mhp,
        dead: !!(self ? self.dead : m.dead),
        auras: self?.auras ?? ent?.auras ?? [],
        bot,
        tank: bot
          ? bot.spec.role === 'tank'
          : JOIN_ROLE === 'tank' && m.name.toLowerCase() === JOIN.toLowerCase(),
        healer: bot
          ? bot.spec.role === 'healer'
          : JOIN_ROLE === 'healer' && m.name.toLowerCase() === JOIN.toLowerCase(),
      });
    }
    this.players = players;
    if (!this.center) this.boss.locate(this);
    if (this.center) this.boss.read?.(this);
  }
  living() {
    return [...this.players.values()].filter((p) => !p.dead);
  }
  prepullSpot(b) {
    const i = this.bots.indexOf(b);
    const side = perp(this.home);
    return add(add(this.prepull, side, ((i % 5) - 2) * 2.2), this.home, Math.floor(i / 5) * 2.2);
  }
  /** Walk toward `goal` (round any obstacle in the way); true once there. */
  moveTo(b, goal, tol = 1.0, faceAt = null) {
    if (!b.self || b.self.dead) return true;
    const d = hypot(b.self, goal);
    if (d <= tol) {
      b.stop(faceAt ? b.faceTo(faceAt) : undefined);
      b.moving = false;
      return true;
    }
    const circles = this.boss.obstacles?.(this) ?? [];
    const wp = circles.length ? steer(b.self, goal, circles) : goal;
    b.input({ f: 1 }, b.faceTo(wp));
    b.moving = true;
    return false;
  }
  blocks(a, c) {
    return this.boss.blocksLine?.(this, a, c) ?? false;
  }
}

// ---- the fight --------------------------------------------------------------------------

async function fight(world, bots, byKey, boss) {
  const st = {
    pullAt: Date.now(),
    result: null,
    bossDeaths: {},
    deaths: [],
    lastHit: new Map(),
    dmgTaken: new Map(),
    dmgDone: new Map(),
    dmgDoneTo: {},
    healDone: new Map(),
    kicks: [],
    taunts: [],
    warnings: [],
    kick: null,
    kickPtr: 0,
    lastStatus: 0,
    errors: new Map(),
    hitLog: [],
    hitsBy: new Map(),
    engagedAt: null,
    lastAggro: Date.now(),
    lastHp: {},
  };
  world.st = st;
  const mt = byKey.mt ?? bots.find((b) => b.spec.role === 'tank');
  log(`PULL: ${mt.name} opens on the ${world.roles[0]} (${DIFF})`);
  fightStart = Date.now();
  st.pullAt = Date.now();
  const deadline = Date.now() + MAX_SECONDS * 1000;
  while (!st.result) {
    const tick = Date.now();
    world.read();
    processEvents(world, bots, st);
    boss.track?.(world, st);
    st.result ??= result(world, st, boss);
    if (st.result) break;
    boss.plan?.(world, st);
    kickCoordinator(world, st, bots, boss);
    for (const b of bots) {
      try {
        act(world, st, b, mt, boss);
      } catch (err) {
        console.error(`${b.name}: ${err.stack}`);
      }
    }
    status(world, st, boss);
    if (Date.now() > deadline) {
      st.result = 'timeout';
      log(`TIME LIMIT (${MAX_SECONDS} s): the fight is called off`);
    }
    const spent = Date.now() - tick;
    await sleep(Math.max(10, 100 - spent));
  }
  for (const b of bots) b.stop();
  await sleep(1200);
  world.read();
  processEvents(world, bots, st);
  return st;
}

function result(world, st, boss) {
  for (const r of world.roles) {
    const m = world.mobs[r];
    if (m && m.mhp) st.lastHp[r] = alive(m) ? m.hp / m.mhp : 0;
  }
  const own = boss.result?.(world, st);
  if (own !== undefined && own !== null) return own;
  const bodies = world.bodies();
  if (bodies.length === world.roles.length && bodies.every((m) => !alive(m))) {
    log(`KILL: the ${boss.title} is defeated`);
    return 'kill';
  }
  if (world.living().length === 0) {
    log('WIPE: the whole raid is down');
    return 'wipe';
  }
  const now = Date.now();
  const engaged = bodies.some((m) => alive(m) && m.aggro != null);
  if (engaged) st.lastAggro = now;
  if (engaged && !st.engagedAt) {
    st.engagedAt = now;
    log('the boss is engaged');
  }
  if (!engaged && now - st.pullAt > 20000 && now - st.lastAggro > (boss.resetGrace ?? 5000)) {
    log('RESET: the boss left the fight (nobody engaged)');
    return 'reset';
  }
  return null;
}

/** Combat events: each bot counts what landed on it and what it dealt, the
 *  observer counts deaths and warnings and a human's share. */
function processEvents(world, bots, st) {
  const now = Date.now();
  const nameOf = (id) =>
    world.players.get(id)?.name ??
    (world.mobIds.has(id)
      ? (world.roles.find((r) => world.mobs[r]?.id === id) ?? `#${id}`)
      : `#${id}`);
  const botPids = new Set(bots.map((b) => b.pid));
  const mine = (b, id) =>
    id === b.pid || (b === world.obs && world.pids.has(id) && !botPids.has(id));
  for (const b of bots) {
    for (const ev of b.drainEvents()) {
      if (ev.type === 'error' && ev.pid === b.pid) {
        const k = `${b.spec.key}: ${ev.text}`;
        st.errors.set(k, (st.errors.get(k) ?? 0) + 1);
      }
      if (ev.type === 'damage') {
        const amount = ev.amount ?? 0;
        if (mine(b, ev.targetId)) {
          const ab = ev.ability ?? (world.mobIds.has(ev.sourceId) ? 'melee swing' : 'other');
          st.dmgTaken.set(ab, (st.dmgTaken.get(ab) ?? 0) + amount);
          st.lastHit.set(ev.targetId, { ability: ab, amount, from: nameOf(ev.sourceId), at: now });
          const who = nameOf(ev.targetId);
          st.hitLog.push({ at: now, ability: ab, who, amount });
          if (st.hitLog.length > 600) st.hitLog.splice(0, st.hitLog.length - 600);
          const rec = st.hitsBy.get(ab) ?? { n: 0, total: 0, max: 0 };
          rec.n++;
          rec.total += amount;
          rec.max = Math.max(rec.max, amount);
          st.hitsBy.set(ab, rec);
        }
        const src = ev.sourceOwnerId ?? ev.sourceId;
        if (mine(b, src) && !world.pids.has(ev.targetId)) {
          st.dmgDone.set(src, (st.dmgDone.get(src) ?? 0) + amount);
          const role = world.roles.find((r) => world.mobs[r]?.id === ev.targetId) ?? 'adds';
          st.dmgDoneTo[role] = (st.dmgDoneTo[role] ?? 0) + amount;
        }
        continue;
      }
      if (ev.type === 'heal2') {
        if (mine(b, ev.sourceId) && world.pids.has(ev.targetId))
          st.healDone.set(ev.sourceId, (st.healDone.get(ev.sourceId) ?? 0) + (ev.amount ?? 0));
        continue;
      }
      if (b !== world.obs) continue;
      if (ev.type === 'death') {
        if (world.pids.has(ev.entityId)) {
          const hit = st.lastHit.get(ev.entityId);
          const who = world.players.get(ev.entityId)?.name ?? `#${ev.entityId}`;
          const cause = hit
            ? `${hit.ability} (${hit.amount} from ${hit.from})`
            : 'unknown (a fall?)';
          st.deaths.push({ t: fightSec(), who, cause, ability: hit?.ability ?? 'unknown' });
          log(`DEATH: ${who} - ${cause}`);
        } else if (world.mobIds.has(ev.entityId)) {
          const role = world.roles.find((r) => world.mobs[r]?.id === ev.entityId);
          if (role && st.bossDeaths[role] === undefined) {
            st.bossDeaths[role] = fightSec();
            log(`BOSS DOWN: ${role} at ${fmtSec(st.bossDeaths[role])}`);
          }
        }
      } else if (ev.type === 'chat' && ev.channel === 'raidWarning') {
        st.warnings.push({ t: fightSec(), text: ev.text });
        log(`  warning: ${ev.text}`);
      }
    }
  }
}

/** Hits of one ability that arrived within [at - before, at + after]. */
export function hitsNear(st, ability, at, before = 400, after = 1000) {
  return st.hitLog.filter(
    (h) => h.ability === ability && h.at >= at - before && h.at <= at + after,
  );
}

// ---- one bot's tick --------------------------------------------------------------------

function act(world, st, b, mt, boss) {
  if (!b.self) return;
  if (b.self.dead) {
    b.stop();
    return;
  }
  const me = world.players.get(b.pid);
  if (!me) return;
  const now = Date.now();
  const role = b.spec.role;
  if (role === 'tank') (boss.tankAssign ?? tankAssign)(world, st, b, me);
  const d = boss.duty?.(world, st, b, me) ?? null;
  let goal = d?.goal ?? null;
  let tol = d?.tol ?? 1.0;
  const duty = d?.duty ?? 'role';
  const hazards = boss.hazards?.(world, st, b, me) ?? [];
  const waitPull = role === 'tank' && b !== mt && !st.engagedAt;
  if (waitPull) goal = world.prepullSpot(b);
  if (!goal) {
    goal = rolePosition(world, st, b, me, hazards, boss);
    tol = role === 'tank' ? 1.5 : 1.0;
  }
  b.duty = duty;
  const faceAt = combatTarget(world, st, b, boss);
  if (d?.hold) {
    b.stop(faceAt ? b.faceTo(faceAt) : undefined);
    b.moving = false;
  } else if (d?.walk) {
    // A boss module steering the bot itself this tick (the wind, a path).
    d.walk(b);
  } else world.moveTo(b, goal, tol, faceAt ?? null);
  b.ticks = (b.ticks ?? 0) + 1;
  if (b.moving) b.movingTicks = (b.movingTicks ?? 0) + 1;
  if (b.self.cast) b.castTicks = (b.castTicks ?? 0) + 1;

  if (waitPull) return;
  if (d?.noAct) return idle(b, d.duty);
  if (d?.cast) {
    // A boss module's own action (an interact, a defensive).
    if (d.cast(b)) return;
  }
  if (b.self.cast) return;
  const kick = st.kick;
  if (kick && kick.kicker === b && !kick.sent && !kick.done) {
    if (now >= kick.reactAt) doKick(world, st, b);
    if (!kick.fumble || now >= kick.reactAt) return idle(b, 'kick');
  }
  const stillFor = b.moving ? 0 : (boss.stillFor?.(world, st, b) ?? 99);
  if (role === 'healer') return healerAct(world, st, b, me, stillFor);
  if (role === 'tank' && tankTaunt(world, st, b)) return;
  if (!faceAt) return idle(b, 'no target');
  const t = faceAt;
  const dist = hypot(b.self, t);
  if (role === 'dps' && !d?.ownThreat && !threatOk(world, b, t)) return idle(b, 'threat');
  if (role === 'dps' && (!st.engagedAt || (now - st.engagedAt) / 1000 < (b.spec.melee ? 2 : 3)))
    return idle(b, 'opening');
  if (b.self.target !== t.id && now - b.lastTargetCmd > 300) {
    b.cmd({ cmd: 'target', id: t.id });
    b.lastTargetCmd = now;
    return idle(b, 'targeting');
  }
  const melee = b.spec.melee || role === 'tank' || b.cls === 'hunter';
  if (melee && !b.self.auto && now - b.lastAttackCmd > 1000) {
    b.cmd({ cmd: 'attack' });
    b.lastAttackCmd = now;
  }
  const reach = (t.reach ?? 0) + (world.boss.meleeReach?.(t) ?? 5.5);
  const rangeOk = b.spec.melee || role === 'tank' ? dist <= reach : dist <= 29 + (t.reach ?? 0);
  if (!rangeOk && role !== 'tank') return idle(b, 'range');
  if (b.cls === 'hunter' && dist < 8.5) return idle(b, 'dead zone');
  if (b.moving && !(b.spec.melee || role === 'tank')) return idle(b, 'moving');
  if (!b.spec.melee && dist > 5.5 && world.blocks(b.self, t)) return idle(b, 'no line');
  const c = rotationContext(world, st, b, me, t, dist, stillFor);
  const ability = ROTATIONS[b.spec.spec]?.(c);
  if (ability) cast(b, ability);
  else
    idle(b, (b.self.gcd ?? 0) > 0.05 ? 'gcd' : stillFor < 2 ? 'must move soon' : 'nothing ready');
}

export function idle(b, why) {
  b.why ??= {};
  b.why[why] = (b.why[why] ?? 0) + 1;
}
export function cast(b, id, target) {
  b.lastSent[id] = Date.now();
  b.sentCount = b.sentCount ?? {};
  b.sentCount[id] = (b.sentCount[id] ?? 0) + 1;
  b.lastCastId = id;
  b.cmd({ cmd: 'cast', ability: id, ...(target !== undefined ? { target } : {}) });
}
export function cdReady(b, id) {
  const cds = b.self?.cds ?? {};
  const cd =
    typeof cds[id] === 'number' ? cds[id] : typeof cds[id]?.rem === 'number' ? cds[id].rem : 0;
  return cd <= 0.05 && Date.now() - (b.lastSent[id] ?? 0) > 450;
}

function rotationContext(world, st, b, me, t, dist, stillFor) {
  const self = b.self;
  const res = self.res ?? 0;
  const mres = self.mres ?? 1;
  const gcdFree = (self.gcd ?? 0) <= 0.05;
  return {
    res,
    combo: self.combo ?? 0,
    manaPct: self.rtype === 'mana' ? res / mres : 1,
    hpPct: (self.hp ?? 1) / (self.mhp ?? 1),
    tPct: (t.hp ?? 1) / (t.mhp ?? 1),
    dist,
    fightAge: (Date.now() - st.pullAt) / 1000,
    selfAura: (id) => hasAura(self, id),
    targetAura: (id) =>
      !!t.auras?.some((a) => a.id === id && (a.src === undefined || a.src === b.pid)),
    pick: (list) => {
      for (const [id, ok] of list) {
        if (!ok || !cdReady(b, id)) continue;
        if (self.rtype === 'mana' && res < (COST[id] ?? 0)) continue;
        const ct = CAST_TIME[id] ?? 0;
        if (ct > 0 && ct + 0.3 > stillFor) continue;
        if (!gcdFree && !OFF_GCD.has(id)) continue;
        return id;
      }
      return null;
    },
  };
}

/** Who this bot hits: a tank its assignment, a damage dealer the boss
 *  module's pick (default: the first living body in role order, adds first). */
function combatTarget(world, st, b, boss) {
  const role = b.spec.role;
  if (role === 'healer') return null;
  if (role === 'tank') {
    const tt = b.tankTarget;
    const m =
      typeof tt === 'number'
        ? (world.obs.ents.get(tt) ?? null)
        : typeof tt === 'string'
          ? world.mobs[tt]
          : null;
    return alive(m) ? m : null;
  }
  const own = boss.targets?.(world, st, b);
  if (own !== undefined) return alive(own) ? own : null;
  for (const r of world.roles)
    if (alive(world.mobs[r]) && world.mobs[r].hostile !== false) return world.mobs[r];
  return null;
}

function threatOk(world, b, mob) {
  const thr = mob.thr;
  if (mob.aggro == null) return true;
  if (mob.aggro === b.pid) return holdThreat(b);
  if (!Array.isArray(thr)) return true;
  let tankHate = 0;
  for (const [id, v] of thr) if (world.players.get(id)?.tank) tankHate = Math.max(tankHate, v);
  if (tankHate <= 0) return world.players.get(mob.aggro)?.tank ? true : holdThreat(b);
  const mine = thr.find(([id]) => id === b.pid)?.[1] ?? 0;
  return mine < tankHate * (b.spec.melee ? 0.9 : 1.1) ? true : holdThreat(b);
}
function holdThreat(b) {
  b.threatHolds = (b.threatHolds ?? 0) + 1;
  if (b.self.auto && Date.now() - b.lastAttackCmd > 1000) {
    b.cmd({ cmd: 'stopattack' });
    b.lastAttackCmd = Date.now();
  }
  return false;
}

/** A spot near `from` outside every hazard (and not bad), or null. */
export function clearSpot(world, from, hazards, maxR = 14) {
  for (let r = 1.5; r <= maxR; r += 1.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const at = { x: from.x + Math.sin(a) * r, z: from.z + Math.cos(a) * r };
      if (!world.boss.onFloor(world, at)) continue;
      if (hazards.some((h) => hypot(h, at) < h.r)) continue;
      if (world.boss.bad?.(world, world.st, at)) continue;
      return at;
    }
  }
  return null;
}

/** Where a bot stands when no mechanic moves it: a tank holding its target
 *  at the boss's tank spot, melee behind the target, ranged and healers on
 *  an arc round the anchor. */
function rolePosition(world, st, b, me, hazards, boss) {
  const role = b.spec.role;
  let want;
  const t = combatTarget(world, st, b, boss);
  if (role === 'tank') {
    const holding = alive(t) && t.aggro === b.pid;
    const spot = boss.tankSpot?.(world, st, b, t) ?? world.anchor;
    const reach = (t?.reach ?? 0) + 3.5;
    if (!alive(t)) want = spot;
    else if (!holding) {
      // A ranged taunt (the paladin's) needs no walk while in its reach.
      const tauntReach = b.cls === 'paladin' ? 27 : reach;
      want = hypot(b.self, t) > tauntReach ? add(t, unit(t, b.self), reach - 1) : b.self;
    } else want = spot;
  } else if (role === 'dps' && b.spec.melee) {
    if (alive(t)) {
      const tank = t.aggro != null ? world.players.get(t.aggro) : null;
      const behind = tank && tank.pid !== b.pid ? unit(tank, t) : unit(world.anchor, t);
      want = add(t, behind, (t.reach ?? 0) + 2.5);
    } else want = world.anchor;
  } else {
    const ranged = world.bots.filter(
      (x) => x.spec.role === 'healer' || (x.spec.role === 'dps' && !x.spec.melee),
    );
    const i = Math.max(0, ranged.indexOf(b));
    const n = Math.max(1, ranged.length);
    const radius = (role === 'healer' ? 15 : 20) * (world.rangeScale ?? 1);
    const span = world.arcSpan ?? 1.6;
    const ang = Math.atan2(world.home.x, world.home.z) + ((i + 0.5) / n - 0.5) * span;
    const arcAt = (da, dr) =>
      add(world.anchor, { x: Math.sin(ang + da), z: Math.cos(ang + da) }, radius + dr);
    want = arcAt(0, 0);
    const sight = sightTargets(world, st, b, boss);
    const reach = role === 'healer' ? 26 : 27;
    const ok = (at) =>
      boss.onFloor(world, at) &&
      !hazards.some((h) => hypot(h, at) < h.r) &&
      !boss.bad?.(world, st, at) &&
      sight.every((q) => hypot(at, q) <= reach + (q.reach ?? 0) && !world.blocks(at, q));
    if (b.goal && hypot(b.goal, want) < 9 && ok(b.goal)) return b.goal;
    if (!ok(want)) {
      search: for (const dr of [0, -4, 4, -7, -10]) {
        for (const da of [0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8]) {
          const at = arcAt(da, dr);
          if (ok(at)) {
            want = at;
            break search;
          }
        }
      }
    }
  }
  const bad = (at) => hazards.some((h) => hypot(h, at) < h.r) || boss.bad?.(world, st, at);
  const keep = b.goal && hypot(b.goal, want) < 3 && !bad(b.goal);
  if (keep) return b.goal;
  const clear = bad(want) ? clearSpot(world, want, hazards) : want;
  b.goal = clear ?? want;
  return b.goal;
}

function sightTargets(world, st, b, boss) {
  if (b.spec.role === 'healer') {
    const up = world.living();
    const out = up.filter((p) => p.tank).map((p) => ({ x: p.x, z: p.z }));
    const worst = up
      .filter((p) => !p.tank && p.hp / Math.max(1, p.mhp) < 0.6)
      .sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
    if (worst) out.push({ x: worst.x, z: worst.z });
    return out;
  }
  const t = combatTarget(world, st, b, boss);
  return alive(t) ? [t] : [];
}

// ---- tanks -----------------------------------------------------------------------------

/** The generic tank plan: the main tank holds role[0], the off-tank every
 *  other body and the adds; a swap aura (`boss.swapAura`, at
 *  `boss.swapStacks` stacks) hands role[0] to the clear tank. */
function tankAssign(world, st, b, me) {
  const boss = world.boss;
  const tanks = world.living().filter((p) => p.tank);
  const main = world.roles[0];
  const holderOf = (m) => (m?.aggro != null ? (world.players.get(m.aggro) ?? null) : null);
  const heavy = (p) => {
    const a = boss.swapAura ? auraOf(p, boss.swapAura) : null;
    return !!a && (a.stacks ?? 1) >= (boss.swapStacks ?? 1);
  };
  let mainTank = tanks.find((p) => p.pid === st.mainTankPid) ?? null;
  const g = world.mobs[main];
  if (!mainTank)
    mainTank =
      (holderOf(g)?.tank ? holderOf(g) : null) ??
      tanks.find((p) => p.bot?.spec.key === 'mt') ??
      tanks[0];
  const other = mainTank ? tanks.find((p) => p.pid !== mainTank.pid) : null;
  if (mainTank && other && heavy(mainTank) && !heavy(other)) {
    if (!st.swapSince || Date.now() - st.swapSince > 3000) {
      mainTank = other;
      st.swapSince = Date.now();
    }
  }
  st.mainTankPid = mainTank?.pid ?? null;
  const wants = [];
  const solo = tanks.length < 2 || !alive(g);
  if (mainTank?.pid === b.pid || solo) {
    if (alive(g)) wants.push(main);
  }
  if (mainTank?.pid !== b.pid || solo) {
    for (const r of world.roles.slice(1)) if (alive(world.mobs[r])) wants.push(r);
    for (const a of world.adds ?? []) if (boss.tankAdd?.(a) !== false) wants.push(a.id);
  }
  const mobOf = (w) => (typeof w === 'number' ? world.obs.ents.get(w) : world.mobs[w]);
  const loose = [];
  for (const w of wants) {
    const m = mobOf(w);
    if (!alive(m)) continue;
    const h = holderOf(m);
    if (!h || h.pid === b.pid) continue;
    // On a non-tank: take it. On the other tank: only when the plan hands it
    // over (the swap gives the main body to the clear tank and the rest to
    // the one that had it), never back and forth.
    const handed =
      !solo && ((w === main && mainTank?.pid === b.pid) || (w !== main && h.pid === mainTank?.pid));
    if (!h.tank || handed) loose.push({ r: w, m, onTank: h.tank });
  }
  loose.sort((x, y) => Number(x.onTank) - Number(y.onTank));
  b.tankTarget = loose[0]?.r ?? wants.find((w) => mobOf(w)?.aggro === b.pid) ?? wants[0] ?? null;
  b.loose = loose[0] ?? null;
}

function tankTaunt(world, st, b) {
  const loose = b.loose;
  if (!loose) return false;
  const { r, m } = loose;
  const tauntId = b.cls === 'warrior' ? 'taunt' : 'sacred_challenge';
  const reach = (b.cls === 'warrior' ? 7.5 : 29) + (m.reach ?? 0);
  if (hypot(b.self, m) > reach || !cdReady(b, tauntId)) return false;
  if (world.blocks(b.self, m)) return false;
  if (b.self.target !== m.id) b.cmd({ cmd: 'target', id: m.id });
  b.stop(b.faceTo(m));
  cast(b, tauntId);
  const holder = world.players.get(m.aggro);
  st.taunts.push({ t: fightSec(), who: b.name, mob: r, from: holder?.name ?? '?' });
  log(
    `TAUNT: ${b.name} takes the ${typeof r === 'number' ? (m.nm ?? m.tid) : r} from ${holder?.name ?? '?'}`,
  );
  return true;
}

// ---- healers ----------------------------------------------------------------------------

function healerAct(world, st, b, me, stillFor) {
  if ((b.self.gcd ?? 0) > 0.05) return idle(b, 'gcd');
  const sees = (p) => p.pid === b.pid || !world.blocks(b.self, p);
  const now = Date.now();
  st.incoming ??= new Map();
  const incoming = (p) => (st.incoming.get(p.pid) ?? 0) > now;
  const members = world.living().filter((p) => hypot(p, b.self) <= 29 && sees(p));
  if (members.length === 0) return idle(b, 'nobody in sight');
  const frac = (p) => p.hp / Math.max(1, p.mhp);
  const need = (p) => 1 - frac(p) + (p.tank ? 0.1 : 0) - (incoming(p) ? 0.25 : 0);
  members.sort((x, y) => need(y) - need(x));
  const low = members[0];
  const lowF = 1 - frac(low);
  const hurt = members.filter((p) => frac(p) < 0.75).length;
  const mana = (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1);
  const can = (id) =>
    cdReady(b, id) &&
    (CAST_TIME[id] ?? 0) + 0.3 <= stillFor &&
    (b.self.res ?? 0) >= (COST[id] ?? 0);
  const heal = (id, p) => {
    if (p && CAST_TIME[id]) {
      b.stop(b.faceTo(p));
      st.incoming.set(p.pid, now + CAST_TIME[id] * 1000 + 300);
    }
    cast(b, id, p?.pid);
  };
  if (b.cls === 'priest') {
    if (lowF > 0.5 && can('flash_heal')) return heal('flash_heal', low);
    if (lowF > 0.45 && low.tank && !hasAura(low, 'power_word_shield') && can('power_word_shield'))
      return heal('power_word_shield', low);
    if (hurt >= 4 && mana > 0.25 && can('prayer_of_healing')) return heal('prayer_of_healing');
    if (lowF > 0.22 && can('heal')) return heal('heal', low);
    const tank = members.find((p) => p.tank && !hasAura(p, 'renew') && frac(p) < 0.92);
    if (tank && mana > 0.3 && can('renew')) return heal('renew', tank);
    return idle(b, healerWhy(b, lowF, mana, stillFor));
  }
  if (lowF > 0.5 && can('tidecall')) return heal('tidecall', low);
  if (hurt >= 3 && can('chain_heal')) return heal('chain_heal', low);
  if (lowF > 0.15 && can('healing_wave')) return heal('healing_wave', low);
  return idle(b, healerWhy(b, lowF, mana, stillFor));
}
function healerWhy(b, lowF, mana, stillFor) {
  if (mana < 0.05) return 'out of mana';
  if (b.moving) return 'moving';
  if (stillFor < 1.8) return 'must move soon';
  return lowF < 0.15 ? 'nobody hurt' : 'waiting';
}

// ---- interrupts -------------------------------------------------------------------------

/** One kick task per kickable bar the boss module names: the next
 *  interrupter in rotation that can reach it reacts after a human-ish delay,
 *  and now and then fumbles. */
function kickCoordinator(world, st, bots, boss) {
  const now = Date.now();
  const bars = boss.kickables?.(world) ?? [];
  const k = st.kick;
  if (k && !k.done) {
    const mob = world.obs.ents.get(k.mobId);
    const cur = alive(mob) ? (mob.cast ?? null) : null;
    if (k.sent && hasAura(mob, `${k.ability}_lockout`)) {
      k.done = true;
      k.result = 'landed';
    } else if (cur !== k.castId || (mob?.castRem ?? 0) > k.lastRem + 0.4) {
      k.done = true;
      k.result =
        k.sent && !k.fumble && k.lastRem > 0.25
          ? 'landed'
          : !k.kicker
            ? 'missed (no interrupter free)'
            : k.fumble
              ? 'missed (fumbled)'
              : k.sent
                ? 'missed (failed)'
                : 'missed (late)';
    } else k.lastRem = mob?.castRem ?? 0;
    if (k.done) {
      st.kicks.push({
        t: fightSec(),
        cast: k.castId,
        who: k.kicker?.name ?? 'nobody',
        result: k.result,
      });
      log(`KICK ${k.castId}: ${k.kicker?.name ?? 'nobody'} - ${k.result}`);
    }
  }
  if (st.kick && !st.kick.done) return;
  const prev = st.kick;
  // A bar not yet handled: another mob or cast, or a fresh one (its time
  // left jumped back up).
  const bar = bars.find(
    (x) =>
      !prev ||
      prev.mobId !== x.mob.id ||
      prev.castId !== x.mob.cast ||
      (x.mob.castRem ?? 0) > prev.lastRem + 0.4,
  );
  if (!bar) return;
  const s = bar.mob;
  let kicker = null;
  for (let i = 0; i < KICK_ORDER.length; i++) {
    const key = KICK_ORDER[(st.kickPtr + i) % KICK_ORDER.length];
    const b = bots.find((x) => x.spec.key === key);
    if (!b || !b.self || b.self.dead) continue;
    const kk = KICKS[b.cls];
    if (!kk || !cdReady(b, kk.id) || (b.self.res ?? 0) < kk.cost) continue;
    if (hypot(b.self, s) > kk.range + (s.reach ?? 0)) continue;
    if (kk.range > 5 && world.blocks(b.self, s)) continue;
    if (b.self.cast && (b.self.castRem ?? 0) > (s.castRem ?? 0) - 0.6) continue;
    if (b.duty !== 'role' && b.moving) continue;
    kicker = b;
    st.kickPtr = (st.kickPtr + i + 1) % KICK_ORDER.length;
    break;
  }
  st.kick = {
    mobId: s.id,
    castId: s.cast,
    lastRem: s.castRem ?? 0,
    kicker,
    ability: kicker ? KICKS[kicker.cls].id : null,
    reactAt: now + 350 + rand() * 550,
    fumble: rand() < KICK_MISS,
    sent: false,
    done: false,
  };
}

function doKick(world, st, b) {
  const k = st.kick;
  const s = world.obs.ents.get(k.mobId);
  k.sent = true;
  if (k.fumble || !alive(s) || !s.cast) return;
  if (b.self.target !== s.id) b.cmd({ cmd: 'target', id: s.id });
  b.stop(b.faceTo(s));
  cast(b, k.ability);
}

// ---- status and the report ----------------------------------------------------------------

function status(world, st, boss) {
  if (process.env.DEBUG && Date.now() - (st.lastDebug ?? 0) > 3000) {
    st.lastDebug = Date.now();
    for (const b of world.bots) {
      if (!b.self) continue;
      const g = b.goal ? hypot(b.self, b.goal).toFixed(1) : '-';
      console.log(
        `  dbg ${b.spec.key.padEnd(6)} duty=${b.duty} goalD=${g} moving=${!!b.moving} cast=${b.self.cast ?? '-'} res=${b.self.res} last=${b.lastCastId ?? '-'} tgt=${b.self.target} hp=${b.self.hp}/${b.self.mhp} pos=${b.self.x.toFixed(1)},${b.self.z.toFixed(1)}`,
      );
    }
  }
  if (Date.now() - st.lastStatus < 15000) return;
  st.lastStatus = Date.now();
  const bosses = world.roles
    .map((r) => {
      const m = world.mobs[r];
      if (!m) return `${r} ?`;
      return `${r} ${alive(m) ? pct(m.hp / m.mhp) : 'dead'}`;
    })
    .join(', ');
  const up = world.living().length;
  log(
    `status: ${bosses}; raid ${up}/${world.players.size} up${boss.statusLine ? `; ${boss.statusLine(world, st)}` : ''}`,
  );
}

function writeReport(world, st, boss) {
  const dur = fightSec();
  note('');
  note('================ SUMMARY ================');
  note(
    `${boss.title}, difficulty ${DIFF}, ${world.bots.length} bots${JOIN ? ` + ${JOIN}` : ''}, gear ${GEAR}${IGNORE ? `, the raid IGNORES ${IGNORE}` : ''}`,
  );
  note(`Result: ${st.result.toUpperCase()} after ${fmtSec(dur)} (${dur.toFixed(0)} s)`);
  for (const r of world.roles) {
    const hp = st.lastHp?.[r];
    note(
      `  ${r.padEnd(10)} ${st.bossDeaths[r] !== undefined ? `died at ${fmtSec(st.bossDeaths[r])}` : `alive at ${hp === undefined ? '?' : pct(hp)} when it ended`}`,
    );
  }
  const done = [...st.dmgDone.values()].reduce((a, b) => a + b, 0);
  note(
    `Raid damage: ${done} (${(done / Math.max(1, dur)).toFixed(0)} DPS); to ${Object.entries(
      st.dmgDoneTo,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  const per = [...st.dmgDone.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([pid, d]) => `${world.players.get(pid)?.name ?? pid} ${(d / Math.max(1, dur)).toFixed(0)}`,
    )
    .join(', ');
  note(`  per player DPS: ${per}`);
  const healedTotal = [...st.healDone.values()].reduce((a, b) => a + b, 0);
  const healed = [...st.healDone.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([pid, d]) => `${world.players.get(pid)?.name ?? pid} ${(d / Math.max(1, dur)).toFixed(0)}`,
    )
    .join(', ');
  note(
    `Healing done: ${healedTotal} (${(healedTotal / Math.max(1, dur)).toFixed(0)} HPS; per healer ${healed || 'none'})`,
  );
  note(
    `Idle ticks by reason: ${world.bots
      .filter((b) => b.why)
      .map(
        (b) =>
          `${b.spec.key} ${Object.entries(b.why)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 4)
            .map(([k, n]) => `${k} ${pct(n / Math.max(1, b.ticks ?? 1))}`)
            .join(' ')}`,
      )
      .join('; ')}`,
  );
  note(
    `Time moving / casting: ${world.bots.map((b) => `${b.spec.key} ${pct((b.movingTicks ?? 0) / Math.max(1, b.ticks ?? 1))}/${pct((b.castTicks ?? 0) / Math.max(1, b.ticks ?? 1))}`).join(', ')}`,
  );
  boss.report?.(world, st, note);
  const landed = st.kicks.filter((k) => k.result === 'landed').length;
  if (st.kicks.length)
    note(
      `Interrupts: ${landed} landed, ${st.kicks.length - landed} missed (${summarize(st.kicks.filter((k) => k.result !== 'landed').map((k) => k.result))})`,
    );
  note(`Taunts: ${st.taunts.length}`);
  note(
    `Deaths: ${st.deaths.length}${st.deaths.length ? ` (${st.deaths.map((d) => `${fmtSec(d.t)} ${d.who}: ${d.cause}`).join('; ')})` : ''}`,
  );
  note(`What killed: ${summarize(st.deaths.map((d) => d.ability)) || 'nothing'}`);
  const taken = [...st.hitsBy.entries()].sort((a, b) => b[1].total - a[1].total);
  note(
    `Damage taken by source (total, hits, biggest): ${taken.map(([k, v]) => `${k} ${v.total}/${v.n}/${v.max}`).join(', ')}`,
  );
  const errs = [...st.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (errs.length)
    note(`Most frequent bot errors: ${errs.map(([k, n]) => `${k} x${n}`).join('; ')}`);
  note('');
  const extra = boss.row?.(world, st) ?? [];
  note(
    `| Boss | Diff | Result | Time | Deaths | Raid DPS | HPS | ${extra.map((x) => x[0]).join(' | ')} |`,
  );
  note(`|---|---|---|---|---|---|---|${extra.map(() => '---|').join('')}`);
  note(
    `| ${boss.key} | ${DIFF}${IGNORE ? ` (ignores ${IGNORE})` : ''} | ${st.result} | ${fmtSec(dur)} | ${st.deaths.length} | ${(done / Math.max(1, dur)).toFixed(0)} | ${(healedTotal / Math.max(1, dur)).toFixed(0)} | ${extra.map((x) => x[1]).join(' | ')} |`,
  );
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const file = path.join(
    LOG_DIR,
    `${boss.key}_${DIFF}${IGNORE ? `_ignore-${IGNORE}` : ''}_${stamp}.txt`,
  );
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`\nfight log written: ${file}`);
  return file;
}
