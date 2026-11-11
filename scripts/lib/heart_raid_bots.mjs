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
//   roleSpot?(world,st,b,me) a bot's own resting spot instead of the generic one
//   opener                 the roster key that pulls (default the main tank 'mt')
//   tauntPad               yards past a taunt's reach a large body still counts (its girth)
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
import { ruinAmountFromAuras } from '../../src/sim/combat/destruction';
import { steer } from './heart_council_tactics.mjs';
import { BUILDS, HEALERS, kitTable, PREPULL, rotate } from './heart_raid_kits.mjs';
import { WorldBot } from './world_bot.mjs';

// ---- configuration ------------------------------------------------------------------

export const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
export const DIFF = (process.env.DIFF ?? 'normal').toLowerCase();
if (!['normal', 'heroic', 'mythic'].includes(DIFF)) throw new Error(`DIFF: ${DIFF}`);
export const JOIN = (process.env.JOIN ?? '').trim();
export const JOIN_ROLE = (process.env.JOIN_ROLE ?? 'dps').toLowerCase();
/** The raid's gear: a Heroic or Mythic raid wears the previous tier's best
 *  (`bis`: the top Nythraxis parse loadouts), a Normal raid the fresh level-20
 *  preset (`kit`), unless GEAR says otherwise. */
export const GEAR = (process.env.GEAR ?? (DIFF === 'normal' ? 'kit' : 'bis')).toLowerCase();
/** A second raid at once (its own ten accounts): BOT_TAG=b logs in as
 *  hcbot_<key>b, so two bot raids can fight side by side on one server. */
export const BOT_TAG = (process.env.BOT_TAG ?? '').replace(/[^a-z0-9]/gi, '');
export const KICK_MISS = Number(process.env.KICK_MISS ?? 0.15);
export const MAX_SECONDS = Number(process.env.MAX_SECONDS ?? 720);
export const LOG_DIR = process.env.LOG_DIR ?? 'tmp/heart_raid';
/** A key mechanic the raid ignores on purpose (the proof that it matters). */
export const IGNORE = (process.env.IGNORE ?? '').toLowerCase();
export const HEROIC_PLUS = DIFF !== 'normal';
/** POOL=0.65: every boss pool of the run times 0.65 (`/dev heart pool`), the
 *  human-equivalent check: the bots deal about 65 percent of a decent human
 *  raid's damage, so the fight then runs on a human raid's clock. */
export const POOL = Number(process.env.POOL ?? 1);
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
const MANA_CLASSES = new Set(['priest', 'shaman', 'mage', 'warlock', 'paladin']);
/** The raid's mana potion (425 mana, the shared two-minute potion clock). */
const MANA_POTION = 'sunpetal_mana_draught';
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
        username: `hcbot_${r.key}${BOT_TAG}`,
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
  // The spec's talent rows (scripts/lib/heart_raid_kits.mjs BUILDS) and the
  // ability table the rotation reads, resolved by the sim with those rows.
  for (const b of bots) {
    const build = BUILDS[b.spec.key];
    b.cmd({ cmd: 'applyTalents', alloc: { spec: build.spec, rows: { ...build.rows } } });
    b.kit = kitTable(b.cls, b.spec.key);
  }
  await sleep(600);
  for (const b of bots)
    b.chat(GEAR === 'bis' ? `/dev bis ${b.spec.spec}` : `/dev kit ${b.spec.spec}`);
  // Every mana user brings mana potions, as a raid does.
  for (const b of bots) if (MANA_CLASSES.has(b.cls)) b.chat(`/dev give ${MANA_POTION} 6`);
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
  leader.chat(`/dev heart pool ${POOL}`);
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
  await waitEntrance(world, bots, byKey, boss);
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

/** A boss body still in its entrance scene: held by the encounter (not
 *  hostile) or wearing its `heart_<boss>_intro` aura (value 0 dormant, 1 the
 *  scene playing). */
function entranceOf(m) {
  if (!alive(m)) return null;
  const a = m.auras?.find((x) => typeof x.id === 'string' && /^heart_.*_intro$/.test(x.id));
  if (a) return (a.value ?? 0) >= 1 ? 'waking' : 'dormant';
  return m.h === false ? 'held' : null;
}

/** Every boss now has an entrance scene (12 to 14 s) in which it cannot be
 *  pulled or harmed. The raid waits it out at its pre-pull spots; a boss still
 *  dormant (nobody stood where it wakes: the Quench wakes only for a body on
 *  the ice) is woken by the opener walking toward it, who then walks back. The
 *  fight's clock starts only once every body is handed back. */
async function waitEntrance(world, bots, byKey, boss) {
  const opener = byKey[boss.opener ?? 'mt'] ?? bots[0];
  // REPLAY_INTRO=1: put the boss back to sleep first (the dev replay), to
  // prove the raid wakes it and waits its scene out.
  if (process.env.REPLAY_INTRO && boss.key !== 'final') {
    world.leader.chat(`/dev heart ${boss.key} intro`);
    await world.leader.chatFlushed();
    await sleep(1500);
  }
  const t0 = Date.now();
  let logged = null;
  let woke = false;
  for (;;) {
    watchPrepull(world);
    drainAll(bots);
    const states = world.bodies().map(entranceOf).filter(Boolean);
    if (states.length === 0) break;
    const stage = states.includes('dormant') ? 'dormant' : 'waking';
    if (stage !== logged) {
      log(
        stage === 'dormant'
          ? 'ENTRANCE: the boss is still dormant'
          : 'ENTRANCE: the scene is playing; the raid waits',
      );
      logged = stage;
    }
    if (stage === 'dormant' && !woke && Date.now() - t0 > 1500) {
      // Walk the opener toward the boss until the scene starts (held: no pull).
      const wake = boss.wakeSpot?.(world) ?? world.center;
      world.moveTo(opener, wake, 2);
    } else {
      if (stage !== 'dormant') woke = true;
      for (const b of bots) world.moveTo(b, world.prepullSpot(b), 1.5);
    }
    if (Date.now() - t0 > 90_000) {
      log('ENTRANCE: still held after 90 s; pulling anyway');
      break;
    }
    await sleep(150);
  }
  if (logged) log(`ENTRANCE: over after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const back = Date.now();
  while (Date.now() - back < 6000) {
    world.read();
    drainAll(bots);
    let all = true;
    for (const b of bots) if (!world.moveTo(b, world.prepullSpot(b), 1.5)) all = false;
    if (all) break;
    await sleep(120);
  }
  for (const b of bots) b.stop();
}

/** Before the pull nothing should be fighting: a boss or an add that takes
 *  someone, or a raider who dies, is logged (the early-pull hunt). */
function watchPrepull(world) {
  world.read();
  world.early ??= { seen: new Set(), dead: new Set() };
  const e = world.early;
  for (const m of [...world.bodies(), ...(world.adds ?? [])]) {
    if (!alive(m) || m.aggro == null || e.seen.has(m.id)) continue;
    e.seen.add(m.id);
    const on = world.players.get(m.aggro);
    log(
      `EARLY PULL: ${m.nm ?? m.tid} (#${m.id}) is on ${on?.name ?? `#${m.aggro}`} at ${on ? hypot(on, m).toFixed(1) : '?'} yd before the pull`,
    );
  }
  for (const p of world.players.values())
    if (p.dead && !e.dead.has(p.pid)) {
      e.dead.add(p.pid);
      log(`EARLY DEATH: ${p.name} died before the pull`);
    }
}

async function napWatching(world, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    watchPrepull(world);
    await sleep(Math.min(250, Math.max(10, end - Date.now())));
  }
}

async function prepullBuffs(world, bots, byKey) {
  // Each spec's own buffs and imbues (PREPULL), one round per list position,
  // the cast-time ones (a summoned demon) given the time they need; a `*`
  // buff goes on every raid member.
  const rounds = Math.max(...bots.map((b) => (PREPULL[b.spec.key] ?? []).length));
  for (let i = 0; i < rounds; i++) {
    let wait = 1600;
    for (const b of bots) {
      const id = PREPULL[b.spec.key]?.[i];
      if (!id || id.endsWith('*')) continue;
      b.cmd({ cmd: 'cast', ability: id });
      wait = Math.max(wait, ((b.kit?.get(id)?.castTime ?? 0) + 0.8) * 1000);
    }
    await napWatching(world, wait);
  }
  for (const b of bots) {
    for (const id of PREPULL[b.spec.key] ?? []) {
      if (!id.endsWith('*')) continue;
      for (const m of b.self?.party?.members ?? []) {
        b.cmd({ cmd: 'cast', ability: id.slice(0, -1), target: m.pid });
        await napWatching(world, 1600);
      }
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    watchPrepull(world);
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
    // Hostile mobs in the fight that are no boss (the adds): engaged, or in
    // the arena (an add walking to its goal, the Heat's Wellspawn, never aggroes).
    this.adds = [...o.ents.values()].filter(
      (e) =>
        e.k === 'mob' &&
        !this.roleOfTid[e.tid] &&
        alive(e) &&
        !!e.h &&
        (e.aggro != null || (this.center && hypot(e, this.center) < (this.reach ?? 60))),
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
  /** Walk toward `goal` (round any obstacle in the way); true once there. A
   *  bot that arrived stays put while it is within `slack` more yards of the
   *  goal, so a resting spot that drifts a little never sets it walking. */
  moveTo(b, goal, tol = 1.0, faceAt = null, slack = 0) {
    if (!b.self || b.self.dead) return true;
    const d = hypot(b.self, goal);
    const settled = b.settled && hypot(b.settled, goal) <= slack + tol && d <= tol + slack;
    if (d <= tol || settled) {
      if (!settled) b.settled = { x: goal.x, z: goal.z };
      if (b.moving || faceAt) b.stop(faceAt ? b.faceTo(faceAt) : undefined);
      b.moving = false;
      return true;
    }
    b.settled = null;
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
  const mt = byKey[boss.opener ?? 'mt'] ?? byKey.mt ?? bots.find((b) => b.spec.role === 'tank');
  log(`PULL: ${mt.name} opens on the ${world.roles[0]} (${DIFF})`);
  // Each body's health as it pulls (gear, talents and buffs in): the
  // yardstick a one-shot is measured against.
  log(`health at the pull: ${bots.map((b) => `${b.name} ${b.self?.mhp ?? '?'}`).join(', ')}`);
  fightStart = Date.now();
  st.pullAt = Date.now();
  const deadline = Date.now() + MAX_SECONDS * 1000;
  while (!st.result) {
    const tick = Date.now();
    // A tick that blocks the loop (a costly plan) freezes all ten bots: each
    // phase is timed and a slow tick says which one held it.
    const lap = [];
    let mark = tick;
    const time = (what) => {
      const now = Date.now();
      lap.push([what, now - mark]);
      mark = now;
    };
    world.read();
    processEvents(world, bots, st);
    time('read');
    boss.track?.(world, st);
    time('track');
    st.result ??= result(world, st, boss);
    if (st.result) break;
    boss.plan?.(world, st);
    time('plan');
    kickCoordinator(world, st, bots, boss);
    for (const b of bots) {
      try {
        act(world, st, b, mt, boss);
      } catch (err) {
        console.error(`${b.name}: ${err.stack}`);
      }
      time(b.spec.key);
    }
    status(world, st, boss);
    if (Date.now() - tick > 400) {
      st.slowTicks = (st.slowTicks ?? 0) + 1;
      const worst = lap
        .filter(([, ms]) => ms >= 20)
        .map(([w, ms]) => `${w} ${ms}`)
        .join(', ');
      log(`  slow tick ${Date.now() - tick} ms (${worst})`);
    }
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
          // Cauterize (the fire mage's lethal save) burns its wearer after it caught
          // a killing blow: the death is that blow's, the burn a late tick.
          if (ab === 'Cauterized') st.burnt = new Set([...(st.burnt ?? []), ev.targetId]);
          else
            st.lastHit.set(ev.targetId, {
              ability: ab,
              amount,
              from: nameOf(ev.sourceId),
              at: now,
            });
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
          st.dmgBy ??= new Map();
          const byAb = st.dmgBy.get(src) ?? {};
          const abKey = ev.sourceOwnerId ? 'pet' : (ev.ability ?? 'melee');
          byAb[abKey] = (byAb[abKey] ?? 0) + amount;
          st.dmgBy.set(src, byAb);
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
          const burnt = st.burnt?.has(ev.entityId);
          st.burnt?.delete(ev.entityId);
          const cause = hit
            ? `${hit.ability} (${hit.amount} from ${hit.from})${burnt ? ', then the Cauterize burn unhealed' : ''}`
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
  // The opener pulls the main body before anything is engaged.
  if (b === mt && !st.engagedAt && alive(world.mobs[world.roles[0]])) {
    b.tankTarget = world.roles[0];
    b.loose = { r: world.roles[0], m: world.mobs[world.roles[0]], onTank: false };
  }
  noteCastResult(b, now);
  const d = boss.duty?.(world, st, b, me) ?? null;
  let goal = d?.goal ?? null;
  let tol = d?.tol ?? 1.0;
  const duty = d?.duty ?? 'role';
  const hazards = boss.hazards?.(world, st, b, me) ?? [];
  const waitPull = role === 'tank' && b !== mt && !st.engagedAt;
  if (waitPull) goal = world.prepullSpot(b);
  let slack = 0.6;
  if (!goal) {
    goal = rolePosition(world, st, b, me, hazards, boss);
    tol = role === 'tank' ? 1.5 : 1.0;
    // A resting spot is a place, not a point: no step for a yard or two of drift.
    // Melee follow a moving body, so only the ranged and healers rest loosely.
    slack = role === 'tank' || b.spec.melee ? 0.8 : 2.5;
  }
  b.prevDuty = b.duty;
  b.prevMoving = b.moving;
  b.duty = duty;
  const faceAt = combatTarget(world, st, b, boss);
  // A cast under way is finished before a step no mechanic asks for: the bot
  // stands in no hazard and its resting spot is near.
  const casting = !!b.self.cast && !b.kit?.get(b.self.cast)?.moving;
  const inHazard = hazards.some((h) => hypot(h, b.self) < h.r) || !!boss.bad?.(world, st, b.self);
  const finishCast =
    casting && duty === 'role' && !waitPull && !inHazard && hypot(b.self, goal) < 8;
  if (d?.hold || finishCast) {
    b.stop(faceAt ? b.faceTo(faceAt) : undefined);
    b.moving = false;
  } else if (d?.walk) {
    // A boss module steering the bot itself this tick (the wind, a path).
    d.walk(b);
  } else world.moveTo(b, goal, tol, faceAt ?? null, slack);
  b.ticks = (b.ticks ?? 0) + 1;
  if (b.moving) b.movingTicks = (b.movingTicks ?? 0) + 1;
  if (b.self.cast) b.castTicks = (b.castTicks ?? 0) + 1;

  if (waitPull) return;
  if (d?.noAct) return idle(b, d.duty);
  if (d?.cast) {
    // A boss module's own action (an interact, a defensive).
    if (d.cast(b)) return;
  }
  drinkPotion(b, now);
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
  // A tank stands at the body's girth (center far past 5.5 yd): melee never needs the line.
  if (!b.spec.melee && role !== 'tank' && dist > 5.5 && world.blocks(b.self, t))
    return idle(b, 'no line');
  const c = rotationContext(world, st, b, me, t, dist, stillFor);
  const ability = rotate(b.spec.spec, c);
  if (ability) {
    // A spell with a bar faces the target first (a stand-still cast).
    if (!b.moving) b.stop(b.faceTo(t));
    cast(b, ability);
  } else
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
  b.pendingCast = { id, at: Date.now(), res: b.self?.res ?? 0 };
  b.cmd({ cmd: 'cast', ability: id, ...(target !== undefined ? { target } : {}) });
}
/** A cast the server turned down (no bar, no GCD, no cooldown, nothing paid a
 *  moment later) is set aside for a second so the rotation tries the next. */
function noteCastResult(b, now) {
  const p = b.pendingCast;
  if (!p || now - p.at < 250) return;
  b.pendingCast = null;
  const took =
    !!b.self.cast ||
    (b.self.gcd ?? 0) > 0.05 ||
    cdLeft(b, p.id) > 0.05 ||
    (b.self.res ?? 0) < p.res - 0.5;
  if (!took) {
    b.failed ??= {};
    b.failed[p.id] = now;
  }
}
function cdLeft(b, id) {
  const v = b.self?.cds?.[id];
  return typeof v === 'number' ? v : typeof v?.rem === 'number' ? v.rem : 0;
}
export function cdReady(b, id) {
  return cdLeft(b, id) <= 0.05 && Date.now() - (b.lastSent[id] ?? 0) > 450;
}
/** A mana user below a third drinks a mana potion when the potion clock allows. */
function drinkPotion(b, now) {
  if (!MANA_CLASSES.has(b.cls) || b.self.rtype !== 'mana') return;
  const mana = (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1);
  if (mana > 0.35 || (b.self.pcd ?? 0) > 0 || now - (b.potionAt ?? 0) < 5000) return;
  b.potionAt = now;
  b.potions = (b.potions ?? 0) + 1;
  b.cmd({ cmd: 'use', item: MANA_POTION });
}

/** True when the rotation may press `id` now: known at this level with these
 *  rows, off cooldown, paid for, the GCD free (unless off it), not refused a
 *  moment ago, and its bar fits the time the bot may stand still (or casts
 *  on the move, or `opts.instant`: a proc made it instant). */
function readyCheck(b, stillFor, id, opts) {
  const k = b.kit?.get(id);
  if (!k) return false;
  if (!cdReady(b, id)) return false;
  if (Date.now() - (b.failed?.[id] ?? 0) < 1200) return false;
  if ((b.self.res ?? 0) < k.cost) return false;
  if (!k.offGcd && (b.self.gcd ?? 0) > 0.05) return false;
  const ct = opts?.instant ? 0 : k.castTime + k.channel;
  if (ct > 0 && !k.moving && (b.moving || ct + 0.3 > stillFor)) return false;
  return true;
}
function auraView(a) {
  return a ? { stacks: a.stacks ?? 1, rem: a.rem ?? 0, value: a.value ?? 0 } : null;
}
/** The rotation's context (scripts/lib/heart_raid_kits.mjs) read from the
 *  bot's own snapshot and its target. */
function rotationContext(world, st, b, me, t, dist, stillFor) {
  const self = b.self;
  return {
    res: self.res ?? 0,
    mres: self.mres ?? 1,
    manaPct: self.rtype === 'mana' ? (self.res ?? 0) / Math.max(1, self.mres ?? 1) : 1,
    combo: self.combo ?? 0,
    hpPct: (self.hp ?? 1) / (self.mhp ?? 1),
    tPct: (t.hp ?? 1) / (t.mhp ?? 1),
    // Melee-normalized: a bot inside the body's melee reach (its girth plus
    // the boss module's reach, which a towering body stretches) reads within
    // 5 yd, as the sim measures a short reach to the body's edge.
    dist: Math.max(0, dist - (t.reach ?? 0) - ((world.boss.meleeReach?.(t) ?? 5.5) - 5.5)),
    age: (Date.now() - st.pullAt) / 1000,
    moving: !!b.moving,
    stillFor,
    devotion: self.pdev?.value ?? 0,
    ruin: ruinAmountFromAuras(self.auras ?? []),
    aura: (id) => auraView(self.auras?.find((a) => a.id === id || a.kind === id)),
    tAura: (id) => auraView(t.auras?.find((a) => a.id === id && a.src === b.pid)),
    ready: (id, opts) => readyCheck(b, stillFor, id, opts),
    // A boss module's add that walks to a goal and slows when hit: worth a
    // slow or a control while it wears none.
    slow:
      !!world.boss.wantSlow?.(world, t) &&
      !(t.auras ?? []).some((a) => /slow|root|stun|incapac|fear|poly|snare/.test(a.kind ?? '')),
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
  for (const [id, v] of thr)
    if (id !== b.pid && world.players.get(id)?.tank) tankHate = Math.max(tankHate, v);
  // No tank on its table: a loose add (on a healer, on a damage dealer)
  // is everyone's to kill, threat or not.
  if (tankHate <= 0) return true;
  const mine = thr.find(([id]) => id === b.pid)?.[1] ?? 0;
  // A decent raid rides the threat meter just under the switch (110 percent in
  // melee, 130 at range).
  return mine < tankHate * (b.spec.melee ? 1.0 : 1.2) ? true : holdThreat(b);
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
  const own = boss.roleSpot?.(world, st, b, me);
  if (own) {
    const bad = (at) => hazards.some((h) => hypot(h, at) < h.r) || boss.bad?.(world, st, at);
    const keepWithin = b.spec.melee || role === 'tank' ? 1 : 3;
    if (b.goal && hypot(b.goal, own) < keepWithin && !bad(b.goal)) return b.goal;
    // A healer casts instead of chasing a spot that drifts with the bosses: it
    // keeps where it stands while that is safe, near its spot and still
    // reaches and sees everyone it must heal (a human healer stands and casts).
    // A boss whose spots ARE the mechanic (the Quench's moving huddles) opts
    // out with `healerSticky: false`.
    if (role === 'healer' && boss.healerSticky !== false) {
      const here = { x: b.self.x, z: b.self.z };
      const sight = sightTargets(world, st, b, boss);
      if (
        hypot(here, own) < 10 &&
        !bad(here) &&
        sight.every((q) => hypot(here, q) <= 26 && !world.blocks(here, q))
      ) {
        b.goal = here;
        return here;
      }
    }
    b.goal = bad(own) ? (clearSpot(world, own, hazards) ?? own) : own;
    return b.goal;
  }
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
    // A spot that still reaches and sees all it must (and is safe) is kept
    // however far the arc's spot drifted (a dragged boss, a turning tank):
    // a caster casts instead of chasing the arc. Healers keep it outright,
    // the ranged while within 16 yd of the arc's spot.
    const here = { x: b.self.x, z: b.self.z };
    if (ok(here) && (role === 'healer' || hypot(here, want) < 16)) {
      b.goal = here;
      return here;
    }
    if (!ok(want)) {
      let found = null;
      search: for (const dr of [0, -4, 4, -7, -10]) {
        for (const da of [0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8]) {
          const at = arcAt(da, dr);
          if (ok(at)) {
            found = at;
            break search;
          }
        }
      }
      // The arc has no clear line (walls between): any bearing round what
      // it must see, in reach, the nearest to the arc's spot.
      const focus = sight[0];
      if (!found && focus) {
        let bestD = Number.POSITIVE_INFINITY;
        for (let r = 10; r <= reach - 2; r += 3) {
          for (let k = 0; k < 32; k++) {
            const a = (k / 32) * Math.PI * 2;
            const at = add(focus, { x: Math.sin(a), z: Math.cos(a) }, r + (focus.reach ?? 0));
            if (!ok(at)) continue;
            const d = hypot(at, want) + hypot(at, b.self) * 0.5;
            if (d < bestD) {
              bestD = d;
              found = at;
            }
          }
        }
      }
      if (found) want = found;
    }
  }
  const bad = (at) => hazards.some((h) => hypot(h, at) < h.r) || boss.bad?.(world, st, at);
  const keep =
    b.goal && hypot(b.goal, want) < (b.spec.melee || role === 'tank' ? 1 : 3) && !bad(b.goal);
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
export function tankAssign(world, st, b, me) {
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
      tanks.find((p) => p.bot?.spec.key === (boss.opener ?? 'mt')) ??
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
  const reach = (b.cls === 'warrior' ? 7.5 : 29) + (m.reach ?? 0) + (world.boss.tauntPad ?? 0);
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
  const living = world.living();
  const inReach = living.filter((p) => hypot(p, b.self) <= 29 && sees(p));
  if (inReach.length === 0) return idle(b, 'nobody in sight');
  const members = inReach.map((p) => ({
    pid: p.pid,
    frac: p.hp / Math.max(1, p.mhp),
    deficit: Math.max(0, p.mhp - p.hp),
    tank: p.tank,
    mainTank: p.pid === st.mainTankPid,
    auras: (p.auras ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      mine: a.src === b.pid,
      value: a.value ?? 0,
    })),
    near: living.filter((q) => q.pid !== p.pid && hypot(q, p) <= 10 && q.hp < q.mhp * 0.9).length,
    // A boss module's extra reason to heal this one first (0 to 0.3): the
    // Quench's Living Warmth makes healing a freezing player lower their cold.
    urgency: world.boss.healUrgency?.(world, p) ?? 0,
  }));
  const h = {
    members,
    mana: (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1),
    moving: !!b.moving,
    incoming: (pid) => (st.incoming.get(pid) ?? 0) > now,
    since: (id) => (now - (b.lastSent[id] ?? 0)) / 1000,
    ready: (id, opts) => readyCheck(b, stillFor, id, opts),
  };
  const pickHeal = HEALERS[b.spec.spec]?.(h) ?? null;
  if (!pickHeal) return idle(b, healerWhy(b, h, stillFor));
  const k = b.kit?.get(pickHeal.id);
  const target = pickHeal.target !== undefined ? world.players.get(pickHeal.target) : null;
  if (target && k && k.castTime > 0) {
    b.stop(b.faceTo(target));
    st.incoming.set(target.pid, now + k.castTime * 1000 + 300);
  }
  cast(b, pickHeal.id, pickHeal.target);
}
function healerWhy(b, h, stillFor) {
  if (h.mana < 0.05) return 'out of mana';
  if (b.moving) return 'moving';
  if (stillFor < 1.8) return 'must move soon';
  const low = Math.min(...h.members.map((p) => p.frac));
  return low > 0.9 ? 'nobody hurt' : 'waiting';
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
    } else {
      k.lastRem = mob?.castRem ?? 0;
      // A bar the raid cannot let through (the boss module's `backupKick`:
      // the council's Wake the Stone once Stone Thrum rings) gets a second
      // interrupter when the first fumbled or none was free, as a raid
      // assigns a backup kick.
      // (A kick sent and refused: the bar still runs half a second on.)
      const refused = k.sent && !k.fumble && now - (k.sentAt ?? now) > 500;
      const stuck = (k.sent && k.fumble) || refused || !k.kicker;
      if (stuck && !k.backup && boss.backupKick?.(k.castId) && k.lastRem > 0.7) {
        const b = pickKicker(world, st, bots, mob, k.kicker);
        if (b) {
          log(`  backup kick on ${k.castId}: ${b.name} (after ${k.kicker?.name ?? 'nobody'})`);
          Object.assign(k, {
            backup: true,
            kicker: b,
            ability: KICKS[b.cls].id,
            fumble: rand() < KICK_MISS,
            sent: false,
            reactAt: now + 250 + rand() * 300,
          });
        }
      }
    }
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
  const kicker = pickKicker(world, st, bots, s);
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

/** The next interrupter in rotation that can reach `s` now (or null). */
function pickKicker(world, st, bots, s, exclude = null) {
  for (let i = 0; i < KICK_ORDER.length; i++) {
    const key = KICK_ORDER[(st.kickPtr + i) % KICK_ORDER.length];
    const b = bots.find((x) => x.spec.key === key);
    if (!b || b === exclude || !b.self || b.self.dead) continue;
    const kk = KICKS[b.cls];
    if (!kk || !cdReady(b, kk.id) || (b.self.res ?? 0) < kk.cost) continue;
    if (hypot(b.self, s) > kk.range + (s.reach ?? 0)) continue;
    if (kk.range > 5 && world.blocks(b.self, s)) continue;
    if (b.self.cast && (b.self.castRem ?? 0) > (s.castRem ?? 0) - 0.6) continue;
    if (b.duty !== 'role' && b.moving) continue;
    st.kickPtr = (st.kickPtr + i + 1) % KICK_ORDER.length;
    return b;
  }
  return null;
}

function doKick(world, st, b) {
  const k = st.kick;
  const s = world.obs.ents.get(k.mobId);
  k.sent = true;
  k.sentAt = Date.now();
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
    `${boss.title}, difficulty ${DIFF}, ${world.bots.length} bots${JOIN ? ` + ${JOIN}` : ''}, gear ${GEAR}${IGNORE ? `, the raid IGNORES ${IGNORE}` : ''}${POOL !== 1 ? `, pools x${POOL} (human-equivalent)` : ''}`,
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
  note(
    `  top damage sources: ${[...(st.dmgBy ?? new Map()).entries()]
      .map(
        ([pid, m]) =>
          `${world.players.get(pid)?.name ?? pid} ${Object.entries(m)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 3)
            .map(([k, v]) => `${k} ${Math.round(v / Math.max(1, dur))}`)
            .join(' ')}`,
      )
      .join('; ')}`,
  );
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
  note(
    `Casts sent: ${world.bots
      .map(
        (b) =>
          `${b.spec.key} ${Object.entries(b.sentCount ?? {})
            .sort((x, y) => y[1] - x[1])
            .slice(0, 6)
            .map(([k, n]) => `${k} ${n}`)
            .join(' ')}`,
      )
      .join('; ')}`,
  );
  note(
    `Mana potions: ${
      world.bots
        .filter((b) => b.potions)
        .map((b) => `${b.spec.key} ${b.potions}`)
        .join(', ') || 'none'
    }; mana at the end: ${world.bots
      .filter((b) => b.self?.rtype === 'mana')
      .map((b) => `${b.spec.key} ${pct((b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1))}`)
      .join(', ')}`,
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
    `${boss.key}_${DIFF}${IGNORE ? `_ignore-${IGNORE}` : ''}${process.env.START ? `_start${process.env.START}` : ''}${POOL !== 1 ? `_pool${POOL}` : ''}_${stamp}${BOT_TAG ? `_${BOT_TAG}` : ''}.txt`,
  );
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`\nfight log written: ${file}`);
  return file;
}
