// The Hammer Council fought by a real raid of bots over the local server
// (docs/design/raid/smith_heart.md section 7.1): ten scripted players (two
// tanks, two healers, six damage dealers) log in through the real REST + world
// socket, form ONE raid group, level and gear to the raid's level with dev
// commands, step into the Smith's Heart, skip down to the Quarry with the
// `/dev heart` helpers and pull the council. Their AI plays the fight only
// from what the server sends (snapshots and events), and the run is written
// up as a fight log: every Wrath and who it hit, the pillars risen, cracked
// and fallen, the soaks, the Resonance cracks, the kicks, the deaths and what
// caused them, and the result.
//
// DEV ONLY: needs the server on SERVER_URL (default http://localhost:8787)
// started with ALLOW_DEV_COMMANDS=1, which must never be set in production.
//
//   node scripts/heart_council_raid.mjs                       autonomous, normal
//   DIFF=heroic ORDER=singer,guardian,slabwright node ...      any kill order
//   JOIN=Jose JOIN_ROLE=dps node scripts/heart_council_raid.mjs
//                                                              9 bots + a human
//
// Environment:
//   DIFF        normal | heroic | mythic (the council's dev switches)
//   ORDER       the damage dealers' kill order, any permutation of
//               guardian,slabwright,singer (default guardian,slabwright,singer)
//   JOIN        a character name: the raid leader invites it and the bots wait
//               for it in the raid and the instance, follow it to the Quarry
//               and pull when it says "pull" in raid chat (or attacks)
//   JOIN_ROLE   dps | healer | tank: which bot steps out for the human
//   GEAR        kit (the fresh level-20 preset, default) | bis (top-parse)
//   KICK_MISS   chance an assigned interrupter fumbles a kick (default 0.15)
//   MAX_SECONDS the fight's time limit (default 720)
//   LOG_DIR     where the fight logs go (default tmp/heart_council)
//   CAPTURE     a .jsonl path: one bot rides the browser client's stable
//               timer wire and its raw frames are written there (the online
//               mirror check replays them into a real ClientWorld)
//   SEED        the kick-fumble rolls' seed (default: the clock)

import fs from 'node:fs';
import path from 'node:path';
import {
  COUNCIL_REACH,
  coverSpots,
  faceDistance,
  onFloor,
  parsePillar,
  pillarBetween,
  rockSpot,
  steer,
  wakeSpot,
} from './lib/heart_council_tactics.mjs';
import { WorldBot } from './lib/world_bot.mjs';

// ---- configuration ------------------------------------------------------------------

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const DIFF = (process.env.DIFF ?? 'normal').toLowerCase();
if (!['normal', 'heroic', 'mythic'].includes(DIFF)) throw new Error(`DIFF: ${DIFF}`);
const ROLES = ['guardian', 'slabwright', 'singer'];
const ORDER = (process.env.ORDER ?? 'guardian,slabwright,singer')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (ORDER.length !== 3 || !ROLES.every((r) => ORDER.includes(r)))
  throw new Error(`ORDER must name guardian, slabwright and singer once each: ${ORDER}`);
const JOIN = (process.env.JOIN ?? '').trim();
const JOIN_ROLE = (process.env.JOIN_ROLE ?? 'dps').toLowerCase();
const GEAR = (process.env.GEAR ?? 'kit').toLowerCase();
const KICK_MISS = Number(process.env.KICK_MISS ?? 0.15);
const MAX_SECONDS = Number(process.env.MAX_SECONDS ?? 720);
const LOG_DIR = process.env.LOG_DIR ?? 'tmp/heart_council';
const CAPTURE = process.env.CAPTURE ?? '';
let seed = Number(process.env.SEED ?? Date.now()) >>> 0;
/** mulberry32: the script's own rolls (kick fumbles, reaction times). */
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Every bot logged in, so a fatal error still logs them out. */
const liveBots = [];

// The council's wire ids (council_ids.ts).
const TID = {
  guardian: 'heart_hammer_guardian',
  slabwright: 'heart_slabwright',
  singer: 'heart_seam_singer',
};
const ROLE_OF_TID = Object.fromEntries(Object.entries(TID).map(([r, t]) => [t, r]));
const CAST = {
  wrath: 'heart_mountains_wrath',
  weight: 'heart_hammers_weight',
  wake: 'heart_wake_the_stone',
  rock: 'heart_falling_rock',
  bolt: 'heart_seam_bolt',
  song: 'heart_song_of_the_seam',
  songUnbroken: 'heart_song_of_the_seam_unbroken',
  echo: 'heart_echo_of_wrath',
  endlessSong: 'heart_endless_song',
};
const AURA = {
  weight: 'heart_hammers_weight',
  wake: 'heart_wake_mark',
  rock: 'heart_falling_rock_mark',
  resonance: 'heart_resonance',
  memory: 'heart_memory_of_stone',
  endlessSong: 'heart_endless_song',
};
const NAMES = {
  wrath: "Mountain's Wrath",
  echo: 'Echo of Wrath',
  rock: 'Falling Rock',
  tremor: 'Rockfall Tremor',
  weight: "Hammer's Weight",
  bolt: 'Seam Bolt',
  wake: 'Wake the Stone',
  rubble: 'Crumbled Stone',
  pulse: 'Restless Stone',
  slab: 'Walking Slab',
  grind: 'Stone Drag',
  endlessSong: 'Endless Song',
};
const RUBBLE = 'sh_council_rubble';
const RISE_SPOT = 'sh_council_rise_spot';
const HEROIC_PLUS = DIFF !== 'normal';

// ---- the raid -------------------------------------------------------------------------

// Cast times of the spells the bots use (a bot only starts one standing still
// with the time to finish it before it must move).
const CAST_TIME = {
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

// Mana costs at level 20 (the resolved kit): a bot never sends a spell it
// cannot pay for.
const COST = {
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

/** A bot's damage rotation: the first ability in the list it may cast now. */
const ROTATIONS = {
  prot: (c) =>
    c.pick([
      ['shield_slam', c.dist <= 5],
      ['revenge', c.res >= 20 && c.dist <= 5],
      ['thunder_clap', c.res >= 20 && c.near(6) >= 1],
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

/** Interrupts: ability, range, cooldown, cost. */
const KICKS = {
  mage: { id: 'counterspell', range: 29, cd: 24, cost: 0 },
  hunter: { id: 'counter_shot', range: 34, cd: 20, cost: 35 },
  warlock: { id: 'spell_lock', range: 29, cd: 24, cost: 0 },
  rogue: { id: 'kick', range: 4.5, cd: 10, cost: 25 },
  warrior: { id: 'pummel', range: 4.5, cd: 10, cost: 0 },
  paladin: { id: 'hushbrand', range: 4.5, cd: 15, cost: 0 },
};

const ROSTER = [
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
// The bot that steps out for a human, by the human's role.
const STEP_OUT = { dps: 'ele', healer: 'h2', tank: 'ot' };
// Interrupters in rotation order (ranged first: they kick from anywhere; the
// off-tank holds the Singer itself, the melee kick when they stand by it).
const KICK_ORDER = ['mage', 'hunter', 'ot', 'lock', 'rogue', 'arms', 'mt'];

// ---- the fight log ------------------------------------------------------------------------

const T0 = Date.now();
let fightStart = null;
const lines = [];
function fightClock() {
  const s = fightStart === null ? -(Date.now() - T0) / 1000 : (Date.now() - fightStart) / 1000;
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${(a % 60).toFixed(1).padStart(4, '0')}`;
}
function log(text) {
  const line = `[${fightClock()}] ${text}`;
  lines.push(line);
  console.log(line);
}
function note(text) {
  lines.push(text);
  console.log(text);
}

// ---- helpers ------------------------------------------------------------------------------

const hypot = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const unit = (from, to) => {
  const d = hypot(from, to) || 1;
  return { x: (to.x - from.x) / d, z: (to.z - from.z) / d };
};
const add = (a, v, k = 1) => ({ x: a.x + v.x * k, z: a.z + v.z * k });
const perp = (v) => ({ x: -v.z, z: v.x });
const hasAura = (e, id) => !!e?.auras?.some((a) => a.id === id);
const auraOf = (e, id) => e?.auras?.find((a) => a.id === id) ?? null;
const pct = (n) => `${Math.round(n * 100)}%`;
const alive = (m) => !!m && !m.dead && (m.hp ?? 0) > 0;

// ---- main ---------------------------------------------------------------------------------

async function main() {
  const roster = JOIN ? ROSTER.filter((r) => r.key !== STEP_OUT[JOIN_ROLE]) : ROSTER;
  if (JOIN && !STEP_OUT[JOIN_ROLE]) throw new Error(`JOIN_ROLE: ${JOIN_ROLE}`);
  const captureStream = CAPTURE ? fs.createWriteStream(CAPTURE) : null;
  const bots = roster.map((r) =>
    Object.assign(
      new WorldBot({
        base: BASE,
        username: `hcbot_${r.key}`,
        password: 'councilbot22',
        name: r.name,
        cls: r.cls,
        // One damage dealer rides the browser client's timer wire, so the
        // soul pillars' state is checked the way the real client reads it.
        stableTimerWire: r.key === 'lock',
        onFrame:
          captureStream && r.key === 'lock' ? (raw) => captureStream.write(`${raw}\n`) : undefined,
      }),
      { spec: r, kickCd: 0, lastSent: {}, lastTargetCmd: 0, lastAttackCmd: 0, goal: null },
    ),
  );
  liveBots.push(...bots);
  const byKey = Object.fromEntries(bots.map((b) => [b.spec.key, b]));
  console.log(
    `Hammer Council raid: ${DIFF}, order ${ORDER.join(' > ')}, ${bots.length} bots${JOIN ? ` + ${JOIN} (${JOIN_ROLE})` : ''}, gear ${GEAR}`,
  );

  for (const b of bots) {
    await b.login();
    await b.connect();
  }
  console.log(`logged in: ${bots.map((b) => `${b.name}(${b.cls} ${b.spec.spec})`).join(', ')}`);
  await sleep(800);

  // Out of any old group, alive, at level 20, specced and geared.
  for (const b of bots) b.cmd({ cmd: 'pleave' });
  await sleep(400);
  for (const b of bots) {
    // Always: a character resumed from an old run can still lie dead in it.
    b.chat('/dev revive');
    b.cmd({ cmd: 'dev_level', level: 20 });
  }
  await flushAll(bots);
  await sleep(600);
  for (const b of bots) b.cmd({ cmd: 'setSpec', spec: b.spec.spec });
  await sleep(600);
  for (const b of bots) {
    b.chat(GEAR === 'bis' ? `/dev bis ${b.spec.spec}` : `/dev kit ${b.spec.spec}`);
  }
  await flushAll(bots);
  await sleep(1200);

  // ONE raid group: the leader invites four, converts, then the rest.
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
        console.log(`>>> invite sent again to ${JOIN}`);
      }
      drainAll(bots);
      await sleep(500);
    }
    console.log(`${JOIN} is in the raid.`);
  }

  // Into the Smith's Heart, the Gallery's packs cleared, down to the Quarry.
  leader.chat('/dev heart enter');
  await flushAll(bots);
  await sleep(800);
  for (const b of others) b.chat('/dev heart enter');
  await flushAll(bots);
  await sleep(800);
  for (const pack of ['h1', 'h2', 'h3']) leader.chat(`/dev heart kill pack ${pack}`);
  leader.chat(
    `/dev heart council ${DIFF === 'mythic' ? 'mythic on' : DIFF === 'heroic' ? 'heroic on' : 'heroic off'}`,
  );
  if (DIFF === 'normal') leader.chat('/dev heart council mythic off');
  await flushAll(bots);
  await sleep(400);

  if (JOIN) {
    console.log(
      `\n>>> ${JOIN}: come into the Smith's Heart (type /dev heart enter). The bots wait for you there and follow you down to the Quarry (or type /dev heart tp pit).`,
    );
    await waitForHumanInside(bots, leader);
  }
  for (const b of bots) b.chat('/dev heart tp pit');
  await flushAll(bots);
  await sleep(1500);
  for (const b of others) for (const ev of b.drainEvents()) heardPull(ev);

  const world = new World(bots, leader);
  world.read();
  if (!world.center) {
    const seen = [...leader.ents.values()].filter((e) => e.k === 'object').map((e) => e.tid);
    const msgs = leader
      .drainEvents()
      .filter((e) => e.type === 'error' || e.type === 'log')
      .map((e) => e.text);
    throw new Error(
      `the Quarry columns are not in sight: leader at ${leader.self?.x?.toFixed(0)},${leader.self?.z?.toFixed(0)}; objects ${seen.slice(0, 12).join(' ')}; ${msgs.slice(-8).join(' | ')}`,
    );
  }
  log(
    `Quarry centre at (${world.center.x.toFixed(1)}, ${world.center.z.toFixed(1)}), ${world.pillars.size} pillars standing`,
  );

  if (JOIN) {
    await followHumanToQuarry(world, bots, leader);
  }

  // Prepull: everyone whole, buffs up, at the raid's spot.
  await prepullBuffs(world, bots, byKey);
  if (JOIN) {
    leader.chat(
      `/p Ready at the Quarry. ${JOIN}: say "pull" in raid chat, or hit one of the three.`,
    );
    console.log(`\n>>> ${JOIN}: say "pull" in raid chat (or attack the council) to start.`);
    await waitForPullCall(world, bots);
  }

  const outcome = await fight(world, bots, byKey);
  const report = writeReport(world, outcome);
  if (JOIN) {
    leader.chat(`/p ${outcome.result === 'kill' ? 'Council down.' : 'Wipe.'} Log: ${report}`);
  }
  for (const b of bots) b.stop();
  await sleep(600);
  for (const b of bots) b.close();
  captureStream?.end();
  await sleep(300);
  process.exit(0);
}

async function flushAll(bots) {
  await Promise.all(bots.map((b) => b.chatFlushed()));
}

function drainAll(bots) {
  for (const b of bots) for (const ev of b.drainEvents()) heardPull(ev);
}

/** The human's "pull" in raid chat, remembered whenever it is heard (even
 *  while the bots are still buffing). */
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
    if (m && Math.abs(m.x - leader.self.x) < 300 && Math.abs(m.z - leader.self.z) < 250) return;
    if (Date.now() - started > 15 * 60_000) throw new Error(`${JOIN} never came into the Heart`);
    drainAll(bots);
    await sleep(500);
  }
}

/** The bots follow the human (dev teleport to their side once, then on
 *  foot) until they stand in the Quarry. */
async function followHumanToQuarry(world, bots, leader) {
  console.log(`following ${JOIN} to the Quarry...`);
  let lastNote = 0;
  for (;;) {
    const m = humanMember(leader, JOIN);
    if (m && hypot(m, world.center) < 42) break;
    if (m) {
      bots.forEach((b, i) => {
        if (!b.self) return;
        const slot = { x: m.x + Math.sin(i * 0.7) * 3, z: m.z + Math.cos(i * 0.7) * 3 };
        const d = hypot(b.self, slot);
        if (d > 30) b.cmd({ cmd: 'dev_teleport', x: slot.x, z: slot.z });
        else if (d > 2.5) b.input({ f: 1 }, b.faceTo(slot));
        else b.stop();
      });
    }
    if (Date.now() - lastNote > 30_000) {
      lastNote = Date.now();
      console.log(`>>> waiting for ${JOIN} in the Quarry (or /dev heart tp pit)`);
    }
    drainAll(bots);
    await sleep(200);
  }
  // Whoever fell behind on the way down (a wall, a stair) catches up.
  for (const b of bots) {
    b.stop();
    if (b.self && hypot(b.self, world.center) > 40) {
      const spot = world.prepullSpot(b);
      b.cmd({ cmd: 'dev_teleport', x: spot.x, z: spot.z });
    }
  }
  await sleep(800);
  console.log(`${JOIN} is in the Quarry.`);
}

async function waitForPullCall(world, bots) {
  for (;;) {
    drainAll(bots);
    if (pullCalled) return;
    world.read();
    if (ROLES.some((r) => alive(world.council[r]) && world.council[r].aggro != null)) return;
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
  // The priest's Fortitude on everyone (one global each).
  const priest = byKey.h1;
  if (priest) {
    for (const m of priest.self?.party?.members ?? []) {
      on(priest, 'power_word_fortitude', m.pid);
      await sleep(1600);
    }
  }
  // Everyone to the raid's spot, then whole again.
  world.read();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    world.read();
    let all = true;
    for (const b of bots) {
      const spot = world.prepullSpot(b);
      if (!world.moveTo(b, spot, 1.5)) all = false;
    }
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

// ---- the world as the raid reads it -------------------------------------------------------

class World {
  constructor(bots, leader) {
    this.bots = bots;
    this.leader = leader;
    this.pids = new Set();
    this.council = { guardian: null, slabwright: null, singer: null };
    this.councilIds = new Set();
    this.pillars = new Map();
    this.rubble = [];
    this.riseSpots = [];
    this.center = null;
    this.home = null;
    this.floor = null;
    this.players = new Map();
    this.prevEnergy = null;
    this.energyRate = 100 / 55;
    this.lastRead = 0;
  }

  /** The observer: the leader (alive or not, it stays in the Quarry). */
  get obs() {
    return this.leader;
  }

  read() {
    const o = this.obs;
    if (!o.self) return;
    this.pids = new Set((o.self.party?.members ?? []).map((m) => m.pid));
    for (const b of this.bots) this.pids.add(b.pid);
    const pillars = new Map();
    const rubble = [];
    const rise = [];
    for (const e of o.ents.values()) {
      if (e.k === 'mob' && ROLE_OF_TID[e.tid]) {
        this.council[ROLE_OF_TID[e.tid]] = e;
        this.councilIds.add(e.id);
        continue;
      }
      if (e.k !== 'object') continue;
      const p = parsePillar(e.tid);
      if (p) {
        pillars.set(e.id, {
          id: e.id,
          tid: e.tid,
          x: e.x,
          z: e.z,
          ...p,
          cast: e.cast ?? null,
          castRem: e.castRem ?? 0,
          auras: e.auras ?? [],
        });
        continue;
      }
      if (e.tid === RUBBLE) rubble.push({ x: e.x, z: e.z, r: (e.sc ?? 3) + 1 });
      else if (typeof e.tid === 'string' && e.tid.startsWith(RISE_SPOT))
        rise.push({ x: e.x, z: e.z, r: (e.sc ?? 3) + 1.4 });
    }
    this.pillars = pillars;
    this.rubble = rubble;
    this.riseSpots = rise;
    if (!this.center) {
      const cols = [...pillars.values()].filter((p) => !p.risen && !p.soul);
      if (cols.length >= 5) {
        this.center = {
          x: cols.reduce((s, p) => s + p.x, 0) / cols.length,
          z: cols.reduce((s, p) => s + p.z, 0) / cols.length,
        };
        this.floor = { x: this.center.x, z: this.center.z, rx: 46, rz: 40 };
        const away = unit(this.center, o.self);
        this.home = away;
        // The tanks' spots: the Guardian just past the middle, its siblings
        // to one side; the raid's arc toward the way in.
        this.tankG = add(this.center, away, -3);
        this.tankS = add(add(this.center, perp(away), 13), away, -1);
        this.anchor = {
          x: (this.tankG.x + this.tankS.x) / 2,
          z: (this.tankG.z + this.tankS.z) / 2,
        };
        this.prepull = add(this.center, away, 30);
      }
    }
    // Players: the party rows (everyone, even out of interest), the entity
    // records for auras and positions when in sight.
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
        hp: self?.hp ?? m.hp,
        mhp: self?.mhp ?? m.mhp,
        dead: !!(self ? self.dead : m.dead),
        auras: self?.auras ?? ent?.auras ?? [],
        bot,
        tank: bot
          ? bot.spec.role === 'tank'
          : JOIN_ROLE === 'tank' && m.name.toLowerCase() === JOIN.toLowerCase(),
      });
    }
    this.players = players;
    // The Wrath's energy rate, measured (the soft enrage speeds it up).
    const h = this.holder();
    const now = Date.now();
    if (h && this.prevEnergy && this.prevEnergy.id === h.id && (h.res ?? 0) > this.prevEnergy.res) {
      const dt = (now - this.prevEnergy.t) / 1000;
      if (dt > 0.5) {
        this.energyRate = 0.7 * this.energyRate + (0.3 * ((h.res ?? 0) - this.prevEnergy.res)) / dt;
        this.prevEnergy = { id: h.id, res: h.res ?? 0, t: now };
      }
    } else if (h) this.prevEnergy = { id: h.id, res: h.res ?? 0, t: now };
    this.lastRead = now;
  }

  /** The member whose energy bar fills (the Wrath's holder). */
  holder() {
    let best = null;
    for (const r of ROLES) {
      const m = this.council[r];
      if (!alive(m) || m.rtype !== 'energy') continue;
      if (!best || (m.res ?? 0) > (best.res ?? 0)) best = m;
    }
    return best;
  }

  /** Seconds until the next Wrath bar begins (the raid must move then), from
   *  the holder's energy and its measured fill; 0 while one is cast. */
  secondsToBar() {
    const h = this.holder();
    if (!h) return Number.POSITIVE_INFINITY;
    if (h.cast === CAST.wrath) return 0;
    return Math.max(0, 100 - (h.res ?? 0)) / Math.max(0.5, this.energyRate);
  }

  coverPillars() {
    return [...this.pillars.values()].filter((p) => !p.soul);
  }
  soulPillars() {
    return [...this.pillars.values()].filter((p) => p.soul);
  }

  /** The cover casts now in flight: the Wrath (any holder) and the Echoes. */
  coverCasts() {
    const out = [];
    for (const r of ROLES) {
      const m = this.council[r];
      if (alive(m) && m.cast === CAST.wrath)
        out.push({ kind: 'wrath', id: m.id, x: m.x, z: m.z, rem: m.castRem ?? 0 });
    }
    for (const p of this.pillars.values()) {
      if (p.cast === CAST.echo)
        out.push({ kind: 'echo', id: p.id, x: p.x, z: p.z, rem: p.castRem ?? 0 });
    }
    return out;
  }

  prepullSpot(b) {
    const i = this.bots.indexOf(b);
    const side = perp(this.home);
    return add(add(this.prepull, side, ((i % 5) - 2) * 2.2), this.home, Math.floor(i / 5) * 2.2);
  }

  /** Walk toward `goal` (round any pillar in the way); true once there. */
  moveTo(b, goal, tol = 1.0, faceAt = null) {
    if (!b.self || b.self.dead) return true;
    const d = hypot(b.self, goal);
    if (d <= tol) {
      b.stop(faceAt ? b.faceTo(faceAt) : undefined);
      b.moving = false;
      return true;
    }
    const circles = [...this.pillars.values()].map((p) => ({ x: p.x, z: p.z, r: p.r }));
    const wp = steer(b.self, goal, circles);
    b.input({ f: 1 }, b.faceTo(wp));
    b.moving = true;
    return false;
  }
}

// ---- the fight --------------------------------------------------------------------------

async function fight(world, bots, byKey) {
  const st = {
    started: false,
    pullAt: Date.now(),
    result: null,
    bossDeaths: {},
    deaths: [],
    lastHit: new Map(),
    dmgTaken: new Map(),
    dmgDone: new Map(),
    dmgDoneTo: { guardian: 0, slabwright: 0, singer: 0 },
    healDone: new Map(),
    wraths: [],
    echoes: [],
    rocks: [],
    wakes: [],
    resonance: [],
    kicks: [],
    pillarEvents: [],
    souls: [],
    weights: [],
    taunts: [],
    warnings: [],
    activeCover: null,
    rock: null,
    wakePlan: new Map(),
    kick: null,
    kickPtr: 0,
    lastStatus: 0,
    prevPillars: new Map(),
    prevCasts: new Map(),
    prevAuras: new Map(),
    slabTrack: null,
    wire: {
      soulSeen: {},
      echoCastSeen: 0,
      songCastSeen: 0,
      songStacksMax: 0,
      slabMoved: 0,
      stableMismatch: [],
    },
    errors: new Map(),
    hitLog: [],
    echoNext: new Map(),
    engagedAt: null,
    lastCouncilAggro: Date.now(),
  };
  world.st = st;
  const mt = byKey.mt ?? bots.find((b) => b.spec.role === 'tank');

  log(`PULL: ${mt.name} opens on the Guardian (${DIFF}, kill order ${ORDER.join(' > ')})`);
  fightStart = Date.now();
  st.pullAt = Date.now();
  const deadline = Date.now() + MAX_SECONDS * 1000;

  while (!st.result) {
    const tick = Date.now();
    world.read();
    processEvents(world, bots, st);
    trackState(world, st);
    if (st.result) break;
    planMechanics(world, st);
    kickCoordinator(world, st, bots);
    for (const b of bots) {
      try {
        act(world, st, b, mt);
      } catch (err) {
        console.error(`${b.name}: ${err.stack}`);
      }
    }
    status(world, st);
    if (Date.now() > deadline) {
      st.result = 'timeout';
      log(`TIME LIMIT (${MAX_SECONDS} s): the fight is called off`);
    }
    const spent = Date.now() - tick;
    await sleep(Math.max(10, 100 - spent));
  }
  for (const b of bots) b.stop();
  // Let the last events (deaths, the final blow) arrive.
  await sleep(1200);
  world.read();
  processEvents(world, bots, st);
  return st;
}

/** Combat events from the observer's stream (the leader's raid sees every
 *  member's), plus every bot's own errors (what it could not do). */
function processEvents(world, bots, st) {
  const now = Date.now();
  const nameOf = (id) =>
    world.players.get(id)?.name ??
    (world.councilIds.has(id)
      ? (ROLES.find((r) => world.council[r]?.id === id) ?? `#${id}`)
      : `#${id}`);
  const botPids = new Set(bots.map((b) => b.pid));
  // Each bot counts what landed on it and what it dealt (its own stream
  // carries both); the observer counts the same for a human in the raid,
  // the deaths and the raid warnings.
  const mine = (b, id) =>
    id === b.pid || (b === world.obs && world.pids.has(id) && !botPids.has(id));
  for (const b of bots) {
    const evs = b.drainEvents();
    for (const ev of evs) {
      if (ev.type === 'error' && ev.pid === b.pid) {
        const k = `${b.spec.key}: ${ev.text}`;
        st.errors.set(k, (st.errors.get(k) ?? 0) + 1);
      }
      if (ev.type === 'damage') {
        const amount = ev.amount ?? 0;
        if (mine(b, ev.targetId)) {
          const ab = ev.ability ?? (world.councilIds.has(ev.sourceId) ? 'melee swing' : 'other');
          st.dmgTaken.set(ab, (st.dmgTaken.get(ab) ?? 0) + amount);
          st.lastHit.set(ev.targetId, { ability: ab, amount, from: nameOf(ev.sourceId), at: now });
          recordMechanicHit(st, ev, ab, amount, nameOf);
        }
        const src = ev.sourceOwnerId ?? ev.sourceId;
        if (mine(b, src) && world.councilIds.has(ev.targetId)) {
          st.dmgDone.set(src, (st.dmgDone.get(src) ?? 0) + amount);
          const role = ROLES.find((r) => world.council[r]?.id === ev.targetId);
          if (role) st.dmgDoneTo[role] += amount;
        }
        continue;
      }
      if (ev.type === 'heal2') {
        // A heal with its healer (the bare `heal` event is the floating text).
        if (mine(b, ev.sourceId) && world.pids.has(ev.targetId))
          st.healDone.set(ev.sourceId, (st.healDone.get(ev.sourceId) ?? 0) + (ev.amount ?? 0));
        continue;
      }
      if (b !== world.obs) continue;
      if (ev.type === 'death') {
        if (world.pids.has(ev.entityId)) {
          const hit = st.lastHit.get(ev.entityId);
          const who = world.players.get(ev.entityId)?.name ?? `#${ev.entityId}`;
          const cause = hit ? `${hit.ability} (${hit.amount} from ${hit.from})` : 'unknown';
          st.deaths.push({ t: fightSec(), who, cause, ability: hit?.ability ?? 'unknown' });
          log(`DEATH: ${who} - ${cause}`);
        } else if (world.councilIds.has(ev.entityId)) {
          const role = ROLES.find((r) => world.council[r]?.id === ev.entityId);
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

function fightSec() {
  return fightStart === null ? 0 : (Date.now() - fightStart) / 1000;
}
function fmtSec(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Mechanic hits are buffered by arrival time: the summaries (a Wrath's, a
 *  rock's) gather them a moment after the landing, whatever order the event
 *  frame and the snapshot that ended the bar came in. */
function recordMechanicHit(st, ev, ab, amount, nameOf) {
  const who = nameOf(ev.targetId);
  st.hitLog.push({ at: Date.now(), ability: ab, who, amount });
  if (st.hitLog.length > 400) st.hitLog.splice(0, st.hitLog.length - 400);
  if (ab === NAMES.weight) {
    st.weights.push({ t: fightSec(), who, amount });
    log(`HAMMER'S WEIGHT lands on ${who} for ${amount}`);
  }
}

function hitsNear(st, ability, at, before = 400, after = 1000) {
  return st.hitLog.filter(
    (h) => h.ability === ability && h.at >= at - before && h.at <= at + after,
  );
}

/** Snapshot diffs: casts started and landed, pillars, marks, souls, the
 *  end of the fight. */
function trackState(world, st) {
  const now = Date.now();
  // The rock lands the moment its mark goes (before the pillar diff below,
  // so a crack it causes is put down to it).
  const lastRock = st.rocks[st.rocks.length - 1];
  if (lastRock && !lastRock.landedAt) {
    const still = [...world.players.values()].some((p) => !p.dead && hasAura(p, AURA.rock));
    if (!still) {
      lastRock.landedAt = now;
      setTimeout(() => {
        lastRock.soakHits = hitsNear(st, NAMES.rock, lastRock.landedAt);
        lastRock.tremor = hitsNear(st, NAMES.tremor, lastRock.landedAt).length;
        const hits = lastRock.soakHits.map((h) => `${h.who} ${h.amount}`).join(', ') || 'nobody';
        log(
          `ROCK landed on ${lastRock.who}: ${lastRock.soakHits.length} under it (${hits})${lastRock.tremor ? `, TREMOR on ${lastRock.tremor}` : ''}${lastRock.cracked.length ? `, cracked #${lastRock.cracked.join(', #')}` : ''}`,
        );
      }, 1100);
    }
  }
  // Cast starts and ends (council bodies and soul pillars).
  const casters = [];
  for (const r of ROLES) if (world.council[r]) casters.push({ key: r, e: world.council[r] });
  for (const p of world.pillars.values()) casters.push({ key: `pillar#${p.id}`, e: p });
  for (const { key, e } of casters) {
    const prev = st.prevCasts.get(key) ?? null;
    const cur = e.cast ?? null;
    if (cur !== prev) {
      if (prev) castEnded(world, st, key, prev, e);
      if (cur) castStarted(world, st, key, cur, e);
      st.prevCasts.set(key, cur);
    }
  }
  // Pillars.
  for (const [id, p] of world.pillars) {
    const before = st.prevPillars.get(id);
    if (!before) {
      if (st.prevPillars.size > 0) {
        log(`PILLAR #${id} rises (${p.risen ? 'risen, 1 use' : 'column'}) at ${where(world, p)}`);
        st.pillarEvents.push({ t: fightSec(), kind: 'rise', id });
      }
      continue;
    }
    if (p.soul && !before.soul) {
      log(`SOUL: the ${p.soul}'s soul takes pillar #${id} (${p.integrity} pips)`);
      // Its first Echo comes 12 s after the soul takes the stone.
      if (p.soul === 'guardian') st.echoNext.set(id, now + 12000);
      st.souls.push({ t: fightSec(), kind: 'take', role: p.soul, id });
    } else if (p.soul && before.soul && p.integrity < before.integrity) {
      const cause = crackCause(world, st, p);
      log(
        `SOUL PIP: ${p.soul} soul pillar #${id} ${before.integrity} -> ${p.integrity} (${cause})`,
      );
      st.souls.push({ t: fightSec(), kind: 'pip', role: p.soul, id, cause });
    } else if (!p.soul && p.integrity < before.integrity) {
      const cause = crackCause(world, st, p);
      log(`CRACK: pillar #${id} ${before.integrity} -> ${p.integrity} (${cause})`);
      st.pillarEvents.push({ t: fightSec(), kind: 'crack', id, cause });
    }
  }
  for (const [id, before] of st.prevPillars) {
    if (world.pillars.has(id)) continue;
    const cause = crackCause(world, st, before);
    if (before.soul) {
      log(`SOUL BURST: the ${before.soul}'s soul pillar #${id} breaks (${cause})`);
      st.souls.push({ t: fightSec(), kind: 'burst', role: before.soul, id, cause });
    } else {
      log(`PILLAR #${id} FALLS (${cause})`);
      st.pillarEvents.push({ t: fightSec(), kind: 'fall', id, cause });
    }
  }
  st.prevPillars = new Map([...world.pillars].map(([id, p]) => [id, { ...p }]));
  // The Walking Slab: how far it has dragged itself.
  const slab = world.soulPillars().find((p) => p.soul === 'slabwright');
  if (slab) {
    if (st.slabTrack && st.slabTrack.id === slab.id) st.wire.slabMoved += hypot(st.slabTrack, slab);
    st.slabTrack = { id: slab.id, x: slab.x, z: slab.z };
  }
  const song = world.soulPillars().find((p) => p.soul === 'singer');
  if (song) {
    const a = song.auras.find((x) => x.id === AURA.endlessSong);
    if (a) st.wire.songStacksMax = Math.max(st.wire.songStacksMax, a.stacks ?? 1);
  }
  checkStableMirror(world, st);
  // Marks on players.
  for (const [pid, p] of world.players) {
    const prev = st.prevAuras.get(pid) ?? new Set();
    const cur = new Set((p.auras ?? []).map((a) => a.id));
    if (cur.has(AURA.resonance) && !prev.has(AURA.resonance)) {
      st.resonance.push({ t: fightSec(), who: p.name, pid });
    }
    st.prevAuras.set(pid, cur);
  }
  // The end: all three down, the raid down, or the council reset.
  const living = ROLES.filter((r) => alive(world.council[r]));
  st.lastHp ??= {};
  for (const r of ROLES) {
    const m = world.council[r];
    if (m && m.mhp) st.lastHp[r] = alive(m) ? m.hp / m.mhp : 0;
  }
  if (living.length === 0 && ROLES.every((r) => world.council[r])) {
    st.result = 'kill';
    log('KILL: the Hammer Council is defeated');
    return;
  }
  const up = [...world.players.values()].filter((p) => !p.dead);
  if (up.length === 0) {
    st.result = 'wipe';
    log('WIPE: the whole raid is down');
    return;
  }
  const engaged = living.some((r) => world.council[r].aggro != null);
  if (engaged) st.lastCouncilAggro = now;
  if (engaged && !st.engagedAt) {
    st.engagedAt = now;
    log('the council is engaged');
  }
  if (!engaged && now - st.pullAt > 15000 && now - st.lastCouncilAggro > 4000) {
    st.result = 'reset';
    log('RESET: the council left the fight (nobody engaged)');
  }
}

/** What took a piece off a pillar (or a pip): the Wrath or the Echo that
 *  just landed, the rock that just fell, else a Resonance carrier close by. */
function crackCause(world, st, p) {
  const now = Date.now();
  const w = st.wraths[st.wraths.length - 1];
  if (w && now - w.landedAt < 900) {
    w.shielded.add(p.id);
    return "Mountain's Wrath";
  }
  const e = st.echoes[st.echoes.length - 1];
  if (e && now - e.landedAt < 900) {
    e.shielded.add(p.id);
    return 'Echo of Wrath';
  }
  const r = st.rocks[st.rocks.length - 1];
  if (r && r.landedAt && now - r.landedAt < 900) {
    r.cracked.push(p.id);
    return 'Falling Rock';
  }
  for (const pl of world.players.values()) {
    if (pl.dead || !hasAura(pl, AURA.resonance)) continue;
    if (faceDistance(p, pl) <= COUNCIL_REACH.resonance + 1.2) {
      st.resonanceCracks = (st.resonanceCracks ?? 0) + 1;
      return `Resonance (${pl.name})`;
    }
  }
  if (world.rubble.length > 0 || p.integrity <= 1) return 'unknown';
  return 'unknown';
}

function where(world, p) {
  if (!world.center) return '?';
  const d = hypot(world.center, p);
  return `${d.toFixed(0)} yd from the middle`;
}

function castStarted(world, st, key, castId, e) {
  if (castId === CAST.wrath) {
    const heir = key !== 'guardian';
    st.activeCover = null;
    log(
      `WRATH cast by the ${key}${heir ? ' (heir)' : ''}: ${(e.castRem ?? 0).toFixed(1)} s to hide`,
    );
  } else if (castId === CAST.echo) {
    log(`ECHO OF WRATH charging on soul pillar ${key}`);
    st.wire.echoCastSeen++;
    // The soul's bar comes every 20 s (council_soul.ts echoEvery).
    st.echoNext.set(e.id, Date.now() + 20000);
  } else if (castId === CAST.endlessSong) {
    st.wire.songCastSeen++;
  } else if (castId === CAST.weight) {
    const t = world.players.get(e.castTgt)?.name ?? '?';
    log(`HAMMER'S WEIGHT cast at ${t}`);
  } else if (castId === CAST.wake) {
    log('WAKE THE STONE cast');
  } else if (castId === CAST.rock) {
    log(`FALLING ROCK cast by the ${key}`);
  } else if (castId === CAST.song || castId === CAST.songUnbroken) {
    log(
      `SONG OF THE SEAM by the ${key}${castId === CAST.songUnbroken ? ' (unbroken, no kick)' : ''}`,
    );
  }
}

function castEnded(world, st, key, castId, e) {
  if (castId === CAST.wrath || castId === CAST.echo) {
    const rec = {
      t: fightSec(),
      caster: key,
      landedAt: Date.now(),
      hits: [],
      shielded: new Set(),
      plan: st.activeCover?.summary ?? null,
      // Where each bot stood against its assigned spot as the bar ended (a
      // hit then reads "short of cover" or "at it").
      short: new Map(
        [...(st.activeCover?.assign ?? new Map())].map(([pid, spot]) => {
          const p = world.players.get(pid);
          return [p?.name ?? String(pid), p ? hypot(p, spot) : -1];
        }),
      ),
    };
    if (castId === CAST.wrath) {
      // A Wrath bar ending without its holder dying lands.
      if (!alive(e)) return;
      st.wraths.push(rec);
    } else st.echoes.push(rec);
    setTimeout(() => {
      rec.hits = hitsNear(st, castId === CAST.wrath ? NAMES.wrath : NAMES.echo, rec.landedAt);
      const hit =
        rec.hits
          .map((h) => {
            const d = rec.short.get(h.who);
            const why =
              d === undefined ? 'no spot' : d > 1.2 ? `${d.toFixed(1)} yd short` : 'at its spot';
            return `${h.who} ${h.amount} (${why})`;
          })
          .join(', ') || 'nobody';
      const sh = [...rec.shielded].map((id) => `#${id}`).join(', ') || 'none';
      log(
        `${castId === CAST.wrath ? 'WRATH' : 'ECHO'} #${(castId === CAST.wrath ? st.wraths : st.echoes).length} landed: hit ${hit}; shielding pillars ${sh}${rec.plan ? `; plan ${rec.plan}` : ''}`,
      );
    }, 1100);
    st.activeCover = null;
  }
}

// ---- the raid's plan: cover, soak, wake ----------------------------------------------------

function planMechanics(world, st) {
  const now = Date.now();
  // Cover: one plan per cover cast set. A raid that reads the holder's
  // energy bar (and counts the Echo's clock) starts toward cover a moment
  // before the bar: the heir's 3 s bar is too short a run from the middle.
  let casts = world.coverCasts();
  let pre = false;
  const coming = [];
  const h = world.holder();
  if (h && !casts.some((c) => c.kind === 'wrath')) {
    const heir = ROLE_OF_TID[h.tid] !== 'guardian';
    const toBar = world.secondsToBar();
    if (toBar <= (heir ? 3.2 : 1.8))
      coming.push({ kind: 'wrath', id: h.id, x: h.x, z: h.z, rem: toBar + (heir ? 3 : 4) });
  }
  for (const [id, at] of st.echoNext) {
    const p = world.pillars.get(id);
    if (!p || p.soul !== 'guardian') {
      st.echoNext.delete(id);
      continue;
    }
    const toBar = (at - now) / 1000;
    if (toBar <= 2 && toBar > -0.5 && !casts.some((c) => c.id === id))
      coming.push({ kind: 'echo', id, x: p.x, z: p.z, rem: Math.max(0, toBar) + 3 });
  }
  if (coming.length > 0) {
    pre = casts.length === 0;
    casts = casts.concat(coming);
  }
  const key = `${casts.map((c) => `${c.kind}${c.id}`).join('+')}${pre ? `@${Math.floor(now / 600)}` : ''}`;
  if (casts.length === 0) st.activeCover = null;
  else if (
    !st.activeCover ||
    st.activeCover.key !== key ||
    st.activeCover.pillarsKey !== pillarsKey(world)
  )
    st.activeCover = planCover(world, st, casts, key, pre);

  // Falling Rock: a soak spot and its soakers, once per mark.
  const marked = [...world.players.values()].find((p) => !p.dead && hasAura(p, AURA.rock));
  if (marked && (!st.rock || st.rock.pid !== marked.pid)) {
    st.rock = planRock(world, st, marked);
    st.rocks.push({
      t: fightSec(),
      who: marked.name,
      markedAt: now,
      landedAt: null,
      soakers: st.rock.soakers.size,
      soakHits: [],
      tremor: 0,
      cracked: [],
      spotOk: !!st.rock.spotOk,
    });
    log(
      `FALLING ROCK on ${marked.name}: soak with ${[...st.rock.soakers].map((pid) => world.players.get(pid)?.name).join(', ')} at ${st.rock.spot ? where(world, st.rock.spot) : 'their feet'}${st.rock.soul ? ` (beside the ${st.rock.soul} soul pillar)` : ''}`,
    );
  } else if (!marked && st.rock) {
    st.rock = null;
  }
  if (st.rock && !world.players.get(st.rock.pid)?.bot) {
    // A human carries it: the soakers stack on them wherever they go.
    const h = world.players.get(st.rock.pid);
    if (h) st.rock.spot = { x: h.x, z: h.z };
  } else if (st.rock?.trackSoul) {
    // The Walking Slab moves: the soak follows it.
    const soul = world.soulPillars().find((p) => p.soul === st.rock.soul);
    if (soul) st.rock.spot = add(soul, unit(soul, st.rock.spot), soul.r + 4.8);
  }

  // Wake the Stone: each marked player carries the mark to a spot.
  for (const p of world.players.values()) {
    if (p.dead || !hasAura(p, AURA.wake)) {
      st.wakePlan.delete(p.pid);
      continue;
    }
    if (st.wakePlan.has(p.pid)) continue;
    const holder = world.holder() ?? world.council.guardian;
    const raidSpot = add(world.anchor, world.home, 18);
    const lane = st.wakePlan.size === 0 ? 0 : 7;
    const spot = wakeSpot({
      holder: holder ?? world.center,
      raid: raidSpot,
      pillars: [...world.pillars.values()].concat(
        [...st.wakePlan.values()].map((w) => ({ ...w.spot })),
      ),
      bodies: ROLES.map((r) => world.council[r]).filter(alive),
      floor: world.floor,
      others: [],
      lane,
    });
    st.wakePlan.set(p.pid, { spot, at: now });
    st.wakes.push({ t: fightSec(), who: p.name, ok: !!spot });
    log(
      `WAKE THE STONE on ${p.name}: carries it to ${spot ? where(world, spot) : 'nowhere clear (stays put)'}`,
    );
  }
}

function pillarsKey(world) {
  return [...world.pillars.values()].map((p) => `${p.id}:${p.integrity}`).join(',');
}

function planCover(world, st, casts, key, pre = false) {
  const sources = casts.map((c) => ({ x: c.x, z: c.z }));
  const cover = world.coverPillars();
  const rem = Math.min(...casts.map((c) => c.rem));
  const assign = new Map();
  const used = new Map();
  const people = [...world.players.values()].filter((p) => !p.dead && p.bot);
  // A Falling Rock that lands before the bar does: its soakers share it in
  // cover of their own, behind a whole column the rock only cracks (the
  // Wrath then spends it), and nobody else hides within the rock's reach.
  const forbidden = new Set();
  const rockGroup = rockCover(world, st, cover, sources, rem);
  if (rockGroup) {
    for (const [pid, spot] of rockGroup.assign) {
      assign.set(pid, spot);
      used.set(spot.pillar.id, (used.get(spot.pillar.id) ?? 0) + 1);
    }
    for (const q of cover)
      if (q.id === rockGroup.pillar.id || faceDistance(q, rockGroup.at) <= COUNCIL_REACH.rock + 1)
        forbidden.add(q.id);
  }
  for (const p of people) {
    if (assign.has(p.pid)) continue;
    const carrier = hasAura(p, AURA.resonance);
    const minFace = carrier
      ? COUNCIL_REACH.resonance + 1.0
      : HEROIC_PLUS
        ? COUNCIL_REACH.pulse + 0.5
        : 1.2;
    let best = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const pl of cover) {
      if (forbidden.has(pl.id)) continue;
      // Resonance carriers keep off the whole pillars even at Wrath.
      for (const spot of coverSpots(pl, cover, sources, minFace)) {
        if (!onFloor(spot, world.floor, 5)) continue;
        if (world.rubble.some((h) => hypot(h, spot) < h.r)) continue;
        if (world.riseSpots.some((h) => hypot(h, spot) < h.r)) continue;
        if (
          carrier &&
          cover.some((q) => q !== pl && faceDistance(q, spot) < COUNCIL_REACH.resonance + 1)
        )
          continue;
        const travel = hypot(p, spot) / 7;
        if (travel > rem - 0.3) continue;
        // Prefer the pillars that will be spent anyway: a risen one (one
        // use), then a cracked column; herd onto those already taken.
        // And keep the pillar a bot was already running to (a replan as the
        // bar starts must not send it the other way with no time left).
        const was = st.activeCover?.assign.get(p.pid)?.pillar?.id === pl.id ? 3 : 0;
        const pref =
          (pl.risen ? 0 : 1.2) + (pl.integrity - 1) * 2.5 - (used.get(pl.id) ?? 0) * 0.6 - was;
        const cost = travel + pref;
        if (cost < bestCost) {
          bestCost = cost;
          best = spot;
        }
      }
    }
    if (best) {
      assign.set(p.pid, best);
      used.set(best.pillar.id, (used.get(best.pillar.id) ?? 0) + 1);
    }
  }
  const summary =
    [...used.entries()].map(([id, n]) => `#${id} x${n}`).join(', ') || 'no reachable cover';
  const unplaced = people.filter((p) => !assign.has(p.pid)).map((p) => p.name);
  const line = `${summary}${unplaced.length ? `; no spot in time for ${unplaced.join(', ')}` : ''}`;
  if (!pre && line !== st.lastCoverLine) log(`  cover plan: ${line}`);
  else if (pre && !st.lastCoverLine?.startsWith('pre'))
    log(`  moving to cover early (the bar is due): ${line}`);
  st.lastCoverLine = pre ? `pre ${line}` : line;
  return { key, pillarsKey: pillarsKey(world), assign, summary, sources };
}

/** The rock's soakers' own cover when the rock lands before the bar: a
 *  column with both its pieces (the rock takes one, the Wrath the other),
 *  the spots behind it close enough to share, reachable in time. Null when
 *  no rock is due first or no column fits. */
function rockCover(world, st, cover, sources, rem) {
  const rock = st.rock;
  if (!rock) return null;
  const marked = world.players.get(rock.pid);
  const rockRem = auraOf(marked, AURA.rock)?.rem ?? 5;
  // Lands after the bar (it then falls in cover anyway), or long enough
  // before it to share it in the open and still run (act's soak rule).
  if (!marked || marked.dead || rockRem > rem - 0.2 || rockRem < rem - 2.2) return null;
  const group = [...rock.soakers]
    .map((pid) => world.players.get(pid))
    .filter((p) => p && !p.dead && p.bot);
  if (!marked.bot) return null;
  let best = null;
  for (const pl of cover) {
    if (pl.integrity < 2) continue;
    for (const at of coverSpots(pl, cover, sources, 1.2)) {
      if (!onFloor(at, world.floor, 5)) continue;
      if (hypot(marked, at) / 7 > rockRem - 0.3) continue;
      // The rock cracks every pillar near where it lands: keep the others out.
      const near = cover.filter(
        (q) => q !== pl && faceDistance(q, at) <= COUNCIL_REACH.rock + 1,
      ).length;
      const cost = near * 10 + hypot(marked, at) / 7;
      if (!best || cost < best.cost) best = { pillar: pl, at, cost };
    }
  }
  if (!best) return null;
  const spots = coverSpots(best.pillar, cover, sources, 1.2).filter(
    (q) => hypot(q, best.at) <= 2.5,
  );
  const assign = new Map();
  for (const p of group) {
    const spot = spots.slice().sort((x, y) => hypot(x, p) - hypot(y, p))[0] ?? best.at;
    if (hypot(p, spot) / 7 <= rem - 0.3) assign.set(p.pid, spot);
  }
  return { pillar: best.pillar, at: best.at, assign };
}

function planRock(world, st, marked) {
  const cover = world.coverPillars();
  // Mythic: share it beside a soul pillar on purpose (a pip off).
  const souls = world.soulPillars();
  const soul = souls.length
    ? souls.reduce((a, b) => (hypot(a, marked) < hypot(b, marked) ? a : b))
    : null;
  const g = world.council.guardian;
  const hazards = [...world.rubble, ...world.riseSpots];
  if (alive(g)) {
    const f = { x: Math.sin(g.f ?? 0), z: Math.cos(g.f ?? 0) };
    hazards.push({ ...add(g, f, 5), r: 6 });
  }
  for (const w of st.wakePlan.values()) if (w.spot) hazards.push({ ...w.spot, r: 4 });
  // A Wrath due a moment after the rock lands: share it near the cover the
  // raid will run to, so the soakers still make it behind a pillar.
  let home = add(world.anchor, world.home, 16);
  let homeWeight = 0.25;
  const h = world.holder();
  const wrathIn = world.secondsToBar() + (h && ROLE_OF_TID[h.tid] !== 'guardian' ? 3 : 4);
  if (h && wrathIn < 5 + 5 && cover.length > 0) {
    const best = cover
      .slice()
      .sort((x, y) => x.integrity - y.integrity || hypot(x, home) - hypot(y, home))[0];
    const behind = coverSpots(best, cover, [h], 1.5)[0];
    if (behind) {
      home = behind;
      homeWeight = 1;
    }
  }
  const spot = rockSpot({
    from: marked,
    cover,
    soul,
    hazards,
    floor: world.floor,
    home,
    homeWeight,
  });
  // The soakers: the nearest healthy non-tanks, none carrying a Wake mark.
  const need = HEROIC_PLUS ? 4 : 3;
  const candidates = [...world.players.values()]
    .filter((p) => !p.dead && p.pid !== marked.pid && p.bot && !p.tank && !hasAura(p, AURA.wake))
    .filter((p) => p.hp / p.mhp > 0.45)
    .sort((a, b) => hypot(a, spot ?? marked) - hypot(b, spot ?? marked));
  const soakers = new Set([marked.pid, ...candidates.slice(0, need).map((p) => p.pid)]);
  return {
    pid: marked.pid,
    spot: spot ?? { x: marked.x, z: marked.z },
    spotOk: !!spot,
    soakers,
    soul: soul && spot ? soul.soul : null,
    trackSoul: !!(soul && spot && soul.soul === 'slabwright'),
  };
}

// ---- one bot's tick --------------------------------------------------------------------

function act(world, st, b, mt) {
  if (!b.self) return;
  if (b.self.dead) {
    b.stop();
    return;
  }
  const me = world.players.get(b.pid);
  if (!me) return;
  const now = Date.now();
  const role = b.spec.role;
  if (role === 'tank') tankAssign(world, st, b, me);
  const cover = st.activeCover;
  const coverSpot = cover?.assign.get(b.pid) ?? null;
  const coverRem = cover ? Math.min(...world.coverCasts().map((c) => c.rem), 99) : 99;

  // 1. Movement duty, highest first.
  let goal = null;
  let tol = 1.0;
  let duty = 'role';
  const rock = st.rock;
  const rockRem = rock ? (auraOf(world.players.get(rock.pid), AURA.rock)?.rem ?? 5) : 99;
  if (coverSpot && !(rock?.soakers.has(b.pid) && rockRem < coverRem - 2.2)) {
    goal = coverSpot;
    tol = 0.6;
    duty = 'cover';
  } else if (st.wakePlan.has(b.pid) && st.wakePlan.get(b.pid).spot) {
    goal = st.wakePlan.get(b.pid).spot;
    tol = 0.8;
    duty = 'wake';
  } else if (rock?.soakers.has(b.pid)) {
    const i = [...rock.soakers].indexOf(b.pid);
    goal =
      i === 0 ? rock.spot : add(rock.spot, { x: Math.sin(i * 1.7), z: Math.cos(i * 1.7) }, 1.6);
    tol = 0.8;
    duty = 'soak';
  } else if (hasAura(me, AURA.resonance) && DIFF === 'mythic' && world.soulPillars().length > 0) {
    const soul = world.soulPillars().reduce((a, c) => (hypot(a, me) < hypot(c, me) ? a : c));
    const face = soul.soul === 'slabwright' ? COUNCIL_REACH.slabGrind - 1.2 : 1.6;
    goal = add(soul, unit(soul, me), soul.r + face);
    tol = 0.7;
    duty = 'break soul';
  }
  // Step out of a rise about to burst, rubble, or someone's Wake spot.
  const hazards = hazardsFor(world, st, b, me, duty);
  // The off-tank lets the main tank open: it waits at the raid's spot.
  const waitPull = role === 'tank' && b !== mt && !st.engagedAt;
  if (waitPull) goal = world.prepullSpot(b);
  if (!goal) goal = rolePosition(world, st, b, me, hazards);
  else if (duty !== 'cover' && hazards.some((h) => hypot(h, goal) < h.r)) {
    goal = clearSpot(world, goal, hazards) ?? goal;
  }
  b.duty = duty;
  const faceAt = combatTarget(world, st, b, me);
  const arrived = world.moveTo(b, goal, tol, faceAt?.pos ?? null);
  b.ticks = (b.ticks ?? 0) + 1;
  if (b.moving) b.movingTicks = (b.movingTicks ?? 0) + 1;
  if (b.self.cast) b.castTicks = (b.castTicks ?? 0) + 1;

  // 2. Actions.
  if (waitPull) return;
  if (b.self.cast) return; // mid-cast: let it finish (moving would cut it)
  const kick = st.kick;
  if (kick && kick.kicker === b && !kick.sent && !kick.done) {
    // The assigned interrupter holds its own casts for the kick.
    if (now >= kick.reactAt) doKick(world, st, b);
    if (!kick.fumble || now >= kick.reactAt) return idle(b, 'kick');
  }
  if (role === 'healer') {
    healerAct(world, st, b, me, arrived, coverRem);
    return;
  }
  if (role === 'tank' && tankTaunt(world, st, b)) return;
  if (!faceAt) return idle(b, 'no target');
  const t = faceAt.ent;
  const dist = hypot(b.self, t);
  // Threat: a damage dealer holds while it is close to the tank's hate, and
  // opens only once the tanks have the council.
  if (role === 'dps' && !threatOk(world, b, t)) return idle(b, 'threat');
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
  const rangeOk = b.spec.melee || role === 'tank' ? dist <= 5.5 : dist <= 29;
  if (!rangeOk && role !== 'tank') return idle(b, 'range');
  if (b.cls === 'hunter' && dist < 8.5) return idle(b, 'dead zone'); // inside the bow's dead zone
  // On the move the bot faces its path, not its target: no swing to waste.
  if (b.moving && !(b.spec.melee || role === 'tank')) return idle(b, 'moving');
  // Behind a pillar (cover, a soak): no line to the target, hold the cast.
  if (!b.spec.melee && dist > 5.5 && pillarBetween([...world.pillars.values()], b.self, t, 0.5))
    return idle(b, 'no line');
  // Hold a cast-time spell when the bot must move before it would finish.
  const stillFor =
    !b.moving && duty !== 'cover' ? Math.min(coverRem, world.secondsToBar() + 0.3) : 0;
  const c = rotationContext(world, st, b, me, t, dist, stillFor);
  const ability = ROTATIONS[b.spec.spec]?.(c);
  if (ability) cast(b, ability);
  else idle(b, (b.self.gcd ?? 0) > 0.05 ? 'gcd' : stillFor < 2 ? 'wrath soon' : 'nothing ready');
}

/** Why a bot did nothing this tick (the report's idle breakdown). */
function idle(b, why) {
  b.why ??= {};
  b.why[why] = (b.why[why] ?? 0) + 1;
}

function cast(b, id, target) {
  b.lastSent[id] = Date.now();
  b.sentCount = b.sentCount ?? {};
  b.sentCount[id] = (b.sentCount[id] ?? 0) + 1;
  b.lastCastId = id;
  b.cmd({ cmd: 'cast', ability: id, ...(target !== undefined ? { target } : {}) });
}

function cdReady(b, id) {
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
    near: (r) =>
      ROLES.filter((k) => alive(world.council[k]) && hypot(world.council[k], self) <= r).length,
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

/** Who this bot hits: tanks their assigned council member, damage dealers
 *  the first living one in the kill order. */
function combatTarget(world, st, b, me) {
  const role = b.spec.role;
  if (role === 'healer') return null;
  if (role === 'tank') {
    const m = b.tankTarget ? world.council[b.tankTarget] : null;
    return alive(m) ? { ent: m, pos: m } : null;
  }
  for (const r of ORDER) {
    const m = world.council[r];
    if (alive(m)) return { ent: m, pos: m };
  }
  return null;
}

function threatOk(world, b, mob) {
  const thr = mob.thr;
  if (mob.aggro == null) return true;
  // It turned on me: stop feeding it until a tank takes it back.
  if (mob.aggro === b.pid) return holdThreat(b);
  if (!Array.isArray(thr)) return true;
  // Measured against the TANKS' hate, not whoever it is beating on: a mob
  // loose on a damage dealer waits for its taunt, it is not a free-for-all.
  let tankHate = 0;
  for (const [id, v] of thr) if (world.players.get(id)?.tank) tankHate = Math.max(tankHate, v);
  if (tankHate <= 0) return world.players.get(mob.aggro)?.tank ? true : holdThreat(b);
  const mine = thr.find(([id]) => id === b.pid)?.[1] ?? 0;
  // A mob turns at 110 percent of its target's hate in melee, 130 at range
  // (src/sim/threat.ts): hold a margin under each.
  return mine < tankHate * (b.spec.melee ? 0.9 : 1.1) ? true : holdThreat(b);
}

/** Holding for threat: no casts, and the white swings stop too. */
function holdThreat(b) {
  b.threatHolds = (b.threatHolds ?? 0) + 1;
  if (b.self.auto && Date.now() - b.lastAttackCmd > 1000) {
    b.cmd({ cmd: 'stopattack' });
    b.lastAttackCmd = Date.now();
  }
  return false;
}

/** Hazards a bot keeps out of for its role spot. */
function hazardsFor(world, st, b, me, duty) {
  const out = [...world.rubble, ...world.riseSpots];
  for (const [pid, w] of st.wakePlan) {
    if (pid === b.pid || !w.spot) continue;
    out.push({ ...w.spot, r: COUNCIL_REACH.riseKnock + 1.2 });
  }
  const carrier = hasAura(me, AURA.resonance);
  for (const p of world.pillars.values()) {
    if (p.soul === 'slabwright' && duty !== 'break soul' && duty !== 'soak')
      out.push({ x: p.x, z: p.z, r: p.r + COUNCIL_REACH.slabGrind + 0.8 });
    else if (!p.soul && carrier)
      out.push({ x: p.x, z: p.z, r: p.r + COUNCIL_REACH.resonance + 1.2 });
    else if (!p.soul && HEROIC_PLUS)
      out.push({ x: p.x, z: p.z, r: p.r + COUNCIL_REACH.pulse + 0.6 });
  }
  const g = world.council.guardian;
  if (alive(g) && b.tankTarget !== 'guardian') {
    const f = { x: Math.sin(g.f ?? 0), z: Math.cos(g.f ?? 0) };
    out.push({ ...add(g, f, 5), r: 5.5 });
  }
  return out;
}

function clearSpot(world, from, hazards) {
  for (let r = 1.5; r <= 12; r += 1.5) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const at = { x: from.x + Math.sin(a) * r, z: from.z + Math.cos(a) * r };
      if (!onFloor(at, world.floor, 6)) continue;
      if (hazards.some((h) => hypot(h, at) < h.r)) continue;
      return at;
    }
  }
  return null;
}

function rolePosition(world, st, b, me, hazards) {
  const role = b.spec.role;
  let want;
  if (role === 'tank') {
    const m = b.tankTarget ? world.council[b.tankTarget] : null;
    const holding = alive(m) && m.aggro === b.pid;
    const spot = b.tankTarget === 'guardian' ? world.tankG : world.tankS;
    if (!alive(m)) want = spot;
    else if (!holding) {
      // Walk into taunt reach (the warrior's is 8 yd).
      want = hypot(b.self, m) > 6 ? add(m, unit(m, b.self), 4) : { x: b.self.x, z: b.self.z };
    } else want = spot;
  } else if (role === 'dps' && b.spec.melee) {
    const t = combatTarget(world, st, b, me)?.ent;
    if (alive(t)) {
      const tank = t.aggro != null ? world.players.get(t.aggro) : null;
      const behind = tank && tank.pid !== b.pid ? unit(tank, t) : unit(world.anchor, t);
      want = add(t, behind, 3);
    } else want = world.anchor;
  } else {
    // Ranged and healers: an arc toward the way in, spread out.
    const ranged = world.bots.filter(
      (x) => x.spec.role === 'healer' || (x.spec.role === 'dps' && !x.spec.melee),
    );
    const i = Math.max(0, ranged.indexOf(b));
    const n = Math.max(1, ranged.length);
    const radius = role === 'healer' ? 15 : 20;
    const span = 1.6;
    const ang = Math.atan2(world.home.x, world.home.z) + ((i + 0.5) / n - 0.5) * span;
    want = add(world.anchor, { x: Math.sin(ang), z: Math.cos(ang) }, radius);
    // A pillar between the bot and what it casts at blocks the cast: slide
    // along the arc (and in or out) to a clear line.
    const sight = sightTargets(world, st, b, me);
    const reach = role === 'healer' ? 26 : 28;
    const seesAll = (at) =>
      sight.every(
        (t) => hypot(at, t) <= reach && !pillarBetween([...world.pillars.values()], at, t, 0.7),
      );
    const ok = (at) =>
      onFloor(at, world.floor, 6) && !hazards.some((h) => hypot(h, at) < h.r) && seesAll(at);
    if (b.goal && hypot(b.goal, want) < 9 && ok(b.goal)) return b.goal;
    if (!ok(want)) {
      search: for (const dr of [0, -4, 4, -7]) {
        for (const da of [0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8]) {
          const at = add(
            world.anchor,
            { x: Math.sin(ang + da), z: Math.cos(ang + da) },
            radius + dr,
          );
          if (ok(at)) {
            want = at;
            break search;
          }
        }
      }
    }
  }
  // Keep the last good spot while it stays good (no jitter).
  const keep = b.goal && hypot(b.goal, want) < 3 && !hazards.some((h) => hypot(h, b.goal) < h.r);
  if (keep) return b.goal;
  const clear = hazards.some((h) => hypot(h, want) < h.r) ? clearSpot(world, want, hazards) : want;
  b.goal = clear ?? want;
  return b.goal;
}

/** What a ranged bot must see (and reach): its focus; a healer, both tanks
 *  and whoever is hurt worst. */
function sightTargets(world, st, b, me) {
  if (b.spec.role === 'healer') {
    const alivePlayers = [...world.players.values()].filter((p) => !p.dead);
    const out = alivePlayers.filter((p) => p.tank).map((p) => ({ x: p.x, z: p.z }));
    const worst = alivePlayers
      .filter((p) => !p.tank && p.hp / Math.max(1, p.mhp) < 0.6)
      .sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
    if (worst) out.push({ x: worst.x, z: worst.z });
    return out;
  }
  const t = combatTarget(world, st, b, me)?.ent;
  return alive(t) ? [{ x: t.x, z: t.z }] : [];
}

// ---- tanks -----------------------------------------------------------------------------

/** Tank duty: the Guardian on the tank without Hammer's Weight (the swap:
 *  the clear tank taunts when the holder wears it), its two siblings on the
 *  other; once the Guardian is down, the two left split between the tanks.
 *  A tank taunts only what is beating on a non-tank, or what the swap or the
 *  split hands it, so the two never trade a mob back and forth. `b.loose`
 *  is what to taunt, `b.tankTarget` what to hit. */
function tankAssign(world, st, b, me) {
  const tanks = [...world.players.values()].filter((p) => p.tank && !p.dead);
  const other = tanks.find((p) => p.pid !== b.pid) ?? null;
  const g = world.council.guardian;
  const weighted = (p) => hasAura(p, AURA.weight);
  const holderOf = (m) => (m?.aggro != null ? (world.players.get(m.aggro) ?? null) : null);
  const living = ROLES.filter((r) => alive(world.council[r]));
  let mine;
  if (alive(g)) {
    const gHolder = holderOf(g);
    // The Guardian's tank is a raid call that changes only on the swap
    // (the holder wears the Weight, the other does not), never because a
    // stray hit drew it: whoever else it turns to, its tank taunts it back.
    let gTank = tanks.find((p) => p.pid === st.gTankPid) ?? null;
    if (!gTank)
      gTank =
        (gHolder?.tank ? gHolder : null) ?? tanks.find((p) => p.bot?.spec.key === 'mt') ?? tanks[0];
    const swapTo = gTank ? tanks.find((p) => p.pid !== gTank.pid) : null;
    if (gTank && swapTo && weighted(gTank) && !weighted(swapTo)) gTank = swapTo;
    st.gTankPid = gTank?.pid ?? null;
    mine = gTank?.pid === b.pid ? ['guardian'] : ['slabwright', 'singer'];
    if (tanks.length < 2) mine = [...living];
  } else if (living.length >= 2 && tanks.length >= 2) {
    mine = tanks[0].pid === b.pid ? ['slabwright'] : ['singer'];
  } else {
    // One left (or one tank): whoever holds it keeps it.
    mine = [...living];
  }
  mine = mine.filter((r) => alive(world.council[r]));
  const loose = [];
  for (const r of mine) {
    const m = world.council[r];
    const h = holderOf(m);
    if (!h || h.pid === b.pid) continue;
    // On a non-tank: take it. On the other tank: only when the assignment
    // hands it over (the Weight swap, the split), never for a lone survivor.
    if (!h.tank || (living.length >= 2 && tanks.length >= 2)) loose.push({ r, m, onTank: h.tank });
  }
  loose.sort((x, y) => Number(x.onTank) - Number(y.onTank));
  b.tankTarget =
    loose[0]?.r ?? mine.find((r) => world.council[r].aggro === b.pid) ?? mine[0] ?? living[0];
  b.loose = loose[0] ?? null;
}

/** Taunt the stray one when in reach; true when a taunt went out. */
function tankTaunt(world, st, b) {
  const loose = b.loose;
  if (!loose) return false;
  const { r, m } = loose;
  const tauntId = b.cls === 'warrior' ? 'taunt' : 'sacred_challenge';
  const reach = b.cls === 'warrior' ? 7.5 : 29;
  if (hypot(b.self, m) > reach || !cdReady(b, tauntId)) return false;
  // Hiding behind a pillar (the Wrath): no line to taunt through.
  if (b.duty === 'cover' || pillarBetween([...world.pillars.values()], b.self, m, 0.3))
    return false;
  if (b.self.target !== m.id) b.cmd({ cmd: 'target', id: m.id });
  b.stop(b.faceTo(m));
  cast(b, tauntId);
  const holder = world.players.get(m.aggro);
  st.taunts.push({ t: fightSec(), who: b.name, mob: r, from: holder?.name ?? '?' });
  log(
    `TAUNT: ${b.name} takes the ${r} from ${holder?.name ?? '?'}${hasAura(holder, AURA.weight) ? " (Hammer's Weight swap)" : ''}`,
  );
  return true;
}

// ---- healers ----------------------------------------------------------------------------

function healerAct(world, st, b, me, arrived, coverRem) {
  if ((b.self.gcd ?? 0) > 0.05) return idle(b, 'gcd');
  const pillars = [...world.pillars.values()];
  const sees = (p) => p.pid === b.pid || !pillarBetween(pillars, b.self, p, 0.5);
  const now = Date.now();
  st.incoming ??= new Map();
  // Who is already being healed by the other healer (its cast in flight).
  const incoming = (p) => (st.incoming.get(p.pid) ?? 0) > now;
  const members = [...world.players.values()].filter(
    (p) => !p.dead && hypot(p, b.self) <= 29 && sees(p),
  );
  if (members.length === 0) return idle(b, 'nobody in sight');
  const frac = (p) => p.hp / Math.max(1, p.mhp);
  const need = (p) => 1 - frac(p) + (p.tank ? 0.1 : 0) - (incoming(p) ? 0.25 : 0);
  members.sort((x, y) => need(y) - need(x));
  const low = members[0];
  const lowF = 1 - frac(low);
  const hurt = members.filter((p) => frac(p) < 0.75).length;
  const mana = (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1);
  const stillFor = !b.moving ? Math.min(coverRem, world.secondsToBar() + 0.3) : 0;
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
  // Shaman.
  if (lowF > 0.5 && can('tidecall')) return heal('tidecall', low);
  if (hurt >= 3 && can('chain_heal')) return heal('chain_heal', low);
  if (lowF > 0.15 && can('healing_wave')) return heal('healing_wave', low);
  return idle(b, healerWhy(b, lowF, mana, stillFor));
}

function healerWhy(b, lowF, mana, stillFor) {
  if (mana < 0.05) return 'out of mana';
  if (b.moving) return 'moving';
  if (stillFor < 1.8) return 'wrath soon';
  return lowF < 0.15 ? 'nobody hurt' : 'waiting';
}

// ---- interrupts -------------------------------------------------------------------------

/** One kick task per kickable bar of the Seam Singer (its own Bolt and Song;
 *  an heir's song is never kickable): the next interrupter in rotation that
 *  can reach it reacts after a human-ish delay, and now and then fumbles. */
function kickCoordinator(world, st, bots) {
  const s = world.council.singer;
  const now = Date.now();
  const cur = alive(s) && (s.cast === CAST.bolt || s.cast === CAST.song) ? s.cast : null;
  const k = st.kick;
  if (k && !k.done) {
    if (k.sent && hasAura(s, `${k.ability}_lockout`)) {
      k.done = true;
      k.result = 'landed';
    } else if (cur !== k.castId || (s.castRem ?? 0) > k.lastRem + 0.4) {
      k.done = true;
      // Cut short after the kick went out: it landed (a diminished lockout
      // still breaks the bar, it only leaves no lockout aura).
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
    } else k.lastRem = s.castRem ?? 0;
    if (k.done) {
      const what = k.castId === CAST.song ? 'Song of the Seam' : 'Seam Bolt';
      st.kicks.push({
        t: fightSec(),
        cast: k.castId === CAST.song ? 'song' : 'bolt',
        who: k.kicker?.name ?? 'nobody',
        result: k.result,
      });
      log(`KICK ${what}: ${k.kicker?.name ?? 'nobody'} - ${k.result}`);
    }
  }
  // A new bar (the done task's bar is over, or a fresh one began).
  // (A task ends with its bar: cut, sung out, or replaced by a fresh one.)
  if (!cur || (st.kick && !st.kick.done)) return;
  // The next interrupter in rotation that can reach it in time.
  let kicker = null;
  for (let i = 0; i < KICK_ORDER.length; i++) {
    const key = KICK_ORDER[(st.kickPtr + i) % KICK_ORDER.length];
    const b = bots.find((x) => x.spec.key === key);
    if (!b || !b.self || b.self.dead) continue;
    const k = KICKS[b.cls];
    if (!k || !cdReady(b, k.id) || (b.self.res ?? 0) < k.cost) continue;
    if (hypot(b.self, s) > k.range) continue;
    if (k.range > 5 && pillarBetween([...world.pillars.values()], b.self, s, 0.5)) continue;
    if (b.self.cast && (b.self.castRem ?? 0) > (s.castRem ?? 0) - 0.6) continue;
    // A kick is instant: a bot carrying a mark or sharing a rock can still
    // throw one; one still running for cover cannot.
    if (b.duty === 'cover' && b.moving) continue;
    kicker = b;
    st.kickPtr = (st.kickPtr + i + 1) % KICK_ORDER.length;
    break;
  }
  st.kick = {
    castId: cur,
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
  const s = world.council.singer;
  k.sent = true;
  if (k.fumble || !alive(s) || !s.cast) return;
  if (b.self.target !== s.id) b.cmd({ cmd: 'target', id: s.id });
  b.stop(b.faceTo(s));
  cast(b, k.ability);
}

// ---- the stable-wire mirror (the browser client's handshake) ---------------------------------

function checkStableMirror(world, st) {
  const lock = world.bots.find((b) => b.stable);
  if (!lock?.self) return;
  for (const p of world.soulPillars()) {
    const seen = lock.ents.get(p.id);
    const tag = `${p.soul}`;
    st.wire.soulSeen[tag] ??= {
      tids: new Set(),
      legacyTids: new Set(),
      castSeenStable: 0,
      auraStacksStable: 0,
    };
    const rec = st.wire.soulSeen[tag];
    rec.legacyTids.add(p.tid);
    if (!seen) {
      if (hypot(lock.self, p) < 60)
        st.wire.stableMismatch.push(
          `${fightSec().toFixed(1)}s: ${tag} pillar #${p.id} missing from the stable mirror`,
        );
      continue;
    }
    rec.tids.add(seen.tid);
    // The two sockets' frames land a tick apart now and then: only a
    // difference that lasts past a second is a gap.
    const off = seen.tid !== p.tid || Math.hypot(seen.x - p.x, seen.z - p.z) > 1.5;
    rec.offSince = off ? (rec.offSince ?? Date.now()) : null;
    if (off && Date.now() - rec.offSince > 1000 && !rec.reported) {
      rec.reported = true;
      st.wire.stableMismatch.push(
        `${fightSec().toFixed(1)}s: #${p.id} ${seen.tid} at ${seen.x.toFixed(1)},${seen.z.toFixed(1)} (stable) vs ${p.tid} at ${p.x.toFixed(1)},${p.z.toFixed(1)} (legacy)`,
      );
    }
    if (seen.cast) rec.castSeenStable++;
    const a = seen.auras?.find((x) => x.id === AURA.endlessSong);
    if (a) rec.auraStacksStable = Math.max(rec.auraStacksStable, a.stacks ?? 1);
  }
}

// ---- status and the report ----------------------------------------------------------------

function status(world, st) {
  if (process.env.DEBUG && Date.now() - (st.lastDebug ?? 0) > 3000) {
    st.lastDebug = Date.now();
    for (const b of world.bots) {
      if (!b.self) continue;
      const g = b.goal ? hypot(b.self, b.goal).toFixed(1) : '-';
      console.log(
        `  dbg ${b.spec.key.padEnd(6)} duty=${b.duty} goalD=${g} moving=${!!b.moving} cast=${b.self.cast ?? '-'} gcd=${b.self.gcd} res=${b.self.res} last=${b.lastCastId ?? '-'} tgt=${b.self.target} hp=${b.self.hp}/${b.self.mhp} pos=${b.self.x.toFixed(1)},${b.self.z.toFixed(1)}`,
      );
    }
  }
  if (Date.now() - st.lastStatus < 15000) return;
  st.lastStatus = Date.now();
  const bosses = ROLES.map((r) => {
    const m = world.council[r];
    if (!m) return `${r} ?`;
    return `${r} ${alive(m) ? pct(m.hp / m.mhp) : 'dead'}`;
  }).join(', ');
  const up = [...world.players.values()].filter((p) => !p.dead).length;
  const h = world.holder();
  const souls = world
    .soulPillars()
    .map((p) => `${p.soul}:${p.integrity}`)
    .join(' ');
  log(
    `status: ${bosses}; raid ${up}/${world.players.size} up; energy ${h ? Math.round(h.res ?? 0) : '-'}; pillars ${[...world.pillars.values()].filter((p) => !p.soul).length}${souls ? `; souls ${souls}` : ''}`,
  );
}

function writeReport(world, st) {
  const dur = fightSec();
  note('');
  note('================ SUMMARY ================');
  note(
    `Difficulty ${DIFF}, kill order ${ORDER.join(' > ')}, ${world.bots.length} bots${JOIN ? ` + ${JOIN}` : ''}, gear ${GEAR}`,
  );
  note(`Result: ${st.result.toUpperCase()} after ${fmtSec(dur)} (${dur.toFixed(0)} s)`);
  for (const r of ROLES) {
    const m = world.council[r];
    const hp = st.lastHp?.[r] ?? (m ? m.hp / m.mhp : null);
    note(
      `  ${r.padEnd(10)} ${st.bossDeaths[r] !== undefined ? `died at ${fmtSec(st.bossDeaths[r])}` : `alive at ${hp === null ? '?' : pct(hp)} when it ended`}`,
    );
  }
  const done = [...st.dmgDone.values()].reduce((a, b) => a + b, 0);
  note(`Raid damage to the council: ${done} (${(done / Math.max(1, dur)).toFixed(0)} DPS)`);
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
  const casts = world.bots
    .map(
      (b) =>
        `${b.spec.key}: ${Object.entries(b.sentCount ?? {})
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map(([id, n]) => `${id} ${n}`)
          .join(' ')}`,
    )
    .join('; ');
  note(`Casts sent (top five per bot): ${casts}`);
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
    `Time moving / casting / holding for threat: ${world.bots.map((b) => `${b.spec.key} ${pct((b.movingTicks ?? 0) / Math.max(1, b.ticks ?? 1))}/${pct((b.castTicks ?? 0) / Math.max(1, b.ticks ?? 1))}/${pct((b.threatHolds ?? 0) / Math.max(1, b.ticks ?? 1))}`).join(', ')}`,
  );
  const wrathHits = st.wraths.reduce((a, w) => a + w.hits.length, 0);
  note(
    `Wraths: ${st.wraths.length} (players hit in total: ${wrathHits}; ${st.wraths.map((w, i) => `#${i + 1} ${w.hits.length} hit, ${w.shielded.size} pillar(s)`).join('; ')})`,
  );
  if (st.echoes.length)
    note(
      `Echoes of Wrath: ${st.echoes.length} (${st.echoes.map((w, i) => `#${i + 1} ${w.hits.length} hit`).join('; ')})`,
    );
  const rises = st.pillarEvents.filter((e) => e.kind === 'rise').length;
  const falls = st.pillarEvents.filter((e) => e.kind === 'fall').length;
  const cracks = st.pillarEvents.filter((e) => e.kind === 'crack').length;
  note(
    `Pillars: ${rises} risen, ${cracks} cracked, ${falls} fallen; ${[...world.pillars.values()].filter((p) => !p.soul).length} standing at the end`,
  );
  const soaks = st.rocks.filter((r) => r.landedAt);
  note(
    `Falling Rocks: ${soaks.length} (${soaks.map((r) => `${r.who}: ${r.soakHits.length} under, ${r.soakHits.length ? Math.round(r.soakHits.reduce((a, h) => a + h.amount, 0) / r.soakHits.length) : 0} each${r.tremor ? ', TREMOR' : ''}${r.cracked.length ? `, cracked ${r.cracked.length}` : ''}`).join('; ')})`,
  );
  note(
    `Wake the Stone marks: ${st.wakes.length}; Resonance marks: ${st.resonance.length}; Resonance cracks: ${st.resonanceCracks ?? 0}`,
  );
  const landed = st.kicks.filter((k) => k.result === 'landed').length;
  note(
    `Interrupts: ${landed} landed, ${st.kicks.length - landed} missed (${summarize(st.kicks.filter((k) => k.result !== 'landed').map((k) => k.result))})`,
  );
  note(`Taunts: ${st.taunts.length}; Hammer's Weight landed ${st.weights.length} times`);
  note(
    `Deaths: ${st.deaths.length}${st.deaths.length ? ` (${st.deaths.map((d) => `${fmtSec(d.t)} ${d.who}: ${d.cause}`).join('; ')})` : ''}`,
  );
  note(`What killed: ${summarize(st.deaths.map((d) => d.ability)) || 'nothing'}`);
  const taken = [...st.dmgTaken.entries()].sort((a, b) => b[1] - a[1]);
  note(`Damage taken by source: ${taken.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (DIFF === 'mythic' || st.souls.length) {
    note(
      `Souls: ${st.souls.map((s) => `${fmtSec(s.t)} ${s.role} ${s.kind}${s.cause ? ` (${s.cause})` : ''}`).join('; ') || 'none'}`,
    );
    note('Soul pillars on the wire (the stable-timer client mirror vs the legacy one):');
    for (const [role, rec] of Object.entries(st.wire.soulSeen))
      note(
        `  ${role}: tids ${[...rec.tids].join(' ')}; legacy ${[...rec.legacyTids].join(' ')}; cast frames ${rec.castSeenStable}; song stacks ${rec.auraStacksStable}`,
      );
    note(
      `  echo bars seen ${st.wire.echoCastSeen}; endless song bars seen ${st.wire.songCastSeen}; song stacks max ${st.wire.songStacksMax}; Walking Slab dragged ${st.wire.slabMoved.toFixed(1)} yd`,
    );
    note(
      `  mismatches: ${st.wire.stableMismatch.length ? st.wire.stableMismatch.slice(0, 10).join(' | ') : 'none'}`,
    );
  }
  const errs = [...st.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (errs.length)
    note(`Most frequent bot errors: ${errs.map(([k, n]) => `${k} x${n}`).join('; ')}`);
  note('');
  note(
    '| Result | Time | Guardian | Slabwright | Singer | Wraths (hit) | Pillars rise/fall | Soaks (avg under) | Kicks ok/miss | Deaths | Raid DPS |',
  );
  note('|---|---|---|---|---|---|---|---|---|---|---|');
  const avgUnder = soaks.length
    ? (soaks.reduce((a, r) => a + r.soakHits.length, 0) / soaks.length).toFixed(1)
    : '-';
  const bd = (r) => (st.bossDeaths[r] !== undefined ? fmtSec(st.bossDeaths[r]) : 'alive');
  note(
    `| ${st.result} | ${fmtSec(dur)} | ${bd('guardian')} | ${bd('slabwright')} | ${bd('singer')} | ${st.wraths.length} (${wrathHits}) | ${rises}/${falls} | ${soaks.length} (${avgUnder}) | ${landed}/${st.kicks.length - landed} | ${st.deaths.length} | ${(done / Math.max(1, dur)).toFixed(0)} |`,
  );

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const file = path.join(LOG_DIR, `${DIFF}_${ORDER.join('-')}_${stamp}.txt`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`\nfight log written: ${file}`);
  return file;
}

function summarize(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => `${k} x${n}`).join(', ');
}

main().catch(async (err) => {
  console.error('fatal:', err);
  // Log the bots out cleanly: a dropped socket holds a character in the
  // world for the linkdead grace (server/linkdead.ts) and blocks the next run.
  for (const b of liveBots) b.close();
  await sleep(500);
  process.exit(1);
});
