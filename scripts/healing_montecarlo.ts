// Monte Carlo healing-vs-heroic analysis harness (the healing companion to
// scripts/nythraxis_matrix.ts and the closed PR #1040 DPS simulator). Drives
// the REAL Sim: level-20 best-in-slot healers and a best-in-slot protection
// warrior against heroic-transformed dungeon mobs, one fresh seeded Sim per
// run, so variance comes from real crit/miss/dodge/parry rolls.
//
// Three benches:
//   A) healer throughput: burst HPS (mana topped up every tick) and sustained
//      throughput (real mana, five second rule) into an always-wounded ally
//   B) heroic intake: tank damage-taken per second from each heroic boss and
//      a representative trash pack (tank topped to full HP every tick so the
//      full DTPS distribution is observable, not censored by death)
//   C) survival: tank plus healer(s) vs each heroic boss with real HP and
//      mana: time-to-tank-death, healer time-to-oom, net HP drain
//
// Run: npx tsx scripts/healing_montecarlo.ts [--runs N] [--quick]
// Writes tmp/healing_mc/report.json and prints the digest tables.

import { mkdirSync, writeFileSync } from 'node:fs';

// Bench-script only: throws with a clear message rather than silently producing
// undefined. The sim contract guarantees these lookups succeed; if they do not
// the run is already broken and an early throw beats a cryptic downstream error.
function must<T>(value: T | undefined, label = 'expected value'): T {
  if (value === undefined) throw new Error(`must: ${label} was undefined`);
  return value;
}

import {
  defaultBuild,
  type TalentAllocation,
  validateAllocation,
} from '../src/sim/content/talents';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { canEquipItem } from '../src/sim/equipment_rules';
import {
  applyDungeonMobTuning,
  type HeroicSpawnRole,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  type EquipSlot,
  type ItemDef,
  MAX_LEVEL,
  MELEE_RANGE,
  type PlayerClass,
} from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// ---------------------------------------------------------------- CLI / knobs

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const runsFlag = args.indexOf('--runs');
const RUNS = runsFlag >= 0 ? Number(args[runsFlag + 1]) : QUICK ? 3 : 12;
const BURST_SECONDS = QUICK ? 30 : 60;
const SUSTAIN_SECONDS = QUICK ? 60 : 240;
const INTAKE_SECONDS = QUICK ? 30 : 90;
const SURVIVAL_CAP_SECONDS = QUICK ? 60 : 240;
const BASE_SEED = 133700;

// Far from overworld content and from every dungeon instance origin
// (instanceOrigin: x = 900 + index * 600, z = -1250 + slot * 500).
const ARENA = { x: -2000, z: 3000 };

// ------------------------------------------------------------------- specs

export type Spec = {
  key: string;
  cls: PlayerClass;
  kind: 'healer' | 'tank' | 'caster';
  talents: TalentAllocation;
  // Heal priority, tried in order each tick. HoTs and shields are guarded by
  // an aura-active check so they refresh instead of being recast every GCD.
  healPriority?: string[];
  // Abilities excluded from bench A (throughput) but kept for bench C, e.g.
  // Psalm of Warding: absorbs never emit heal2, so they would undercount HPS.
  benchExclude?: string[];
  // Cast on self when mana drops below a quarter (Innervate style).
  emergencyMana?: string;
  setup?: string[];
};

// Row picks favor healing output and mana wherever a row offers one.
export const HEALER_SPECS: Spec[] = [
  {
    key: 'holy_priest',
    cls: 'priest',
    kind: 'healer',
    talents: {
      spec: 'holy',
      rows: {
        5: 'pri_r5_improved_renew',
        8: 'pri_r8_improved_shield',
        11: 'pri_r11_meditation',
        14: 'pri_r14_greater_heal',
        17: 'pri_r17_desperate_prayer',
        20: 'pri_r20_prayer_of_healing',
      },
    },
    healPriority: ['renew', 'flash_heal', 'heal', 'lesser_heal'],
  },
  {
    key: 'discipline_priest',
    cls: 'priest',
    kind: 'healer',
    talents: {
      spec: 'discipline',
      rows: {
        5: 'pri_r5_improved_renew',
        8: 'pri_r8_improved_shield',
        11: 'pri_r11_meditation',
        14: 'pri_r14_greater_heal',
        17: 'pri_r17_desperate_prayer',
        20: 'pri_r20_prayer_of_healing',
      },
    },
    healPriority: ['power_word_shield', 'renew', 'flash_heal', 'heal', 'lesser_heal'],
    benchExclude: ['power_word_shield'],
  },
  {
    key: 'restoration_druid',
    cls: 'druid',
    kind: 'healer',
    talents: {
      spec: 'restoration',
      rows: {
        5: 'dru_r5_natures_bounty',
        8: 'dru_r8_improved_roots',
        11: 'dru_r11_innervate',
        14: 'dru_r14_empowered_touch',
        17: 'dru_r17_improved_barkskin',
        20: 'dru_r20_tranquility',
      },
    },
    healPriority: ['rejuvenation', 'regrowth', 'healing_touch'],
    emergencyMana: 'innervate',
  },
  {
    key: 'restoration_shaman',
    cls: 'shaman',
    kind: 'healer',
    talents: {
      spec: 'restoration',
      rows: {
        5: 'sha_r5_imbue_mastery',
        8: 'sha_r8_shock_efficiency',
        11: 'sha_r11_healing_stream',
        14: 'sha_r14_improved_flame_shock',
        17: 'sha_r17_elemental_warding',
        20: 'sha_r20_tidal_waves',
      },
    },
    healPriority: ['healing_wave'],
  },
  {
    key: 'holy_paladin',
    cls: 'paladin',
    kind: 'healer',
    talents: {
      spec: 'holy',
      rows: {
        5: 'pal_r5_blessed_momentum',
        8: 'pal_r8_cleansing_verdict',
        11: 'pal_r11_divine_wisdom',
        14: 'pal_r14_righteous_cause',
        17: 'pal_r17_sacred_ward',
        20: 'pal_r20_aura_mastery',
      },
    },
    healPriority: ['holy_shock', 'flash_of_light', 'holy_light'],
  },
];

export const TANK_SPEC: Spec = {
  key: 'protection_warrior',
  cls: 'warrior',
  kind: 'tank',
  talents: {
    spec: 'prot',
    rows: {
      5: 'war_row_double_charge',
      8: 'war_row_second_wind',
      11: 'war_row_piercing_howl',
      14: 'war_row_anger_management',
      17: 'war_row_avatar',
      20: 'war_row_colossal_might',
    },
  },
  setup: ['defensive_stance'],
};

export const HOT_OR_SHIELD_GUARD = new Set([
  'renew',
  'rejuvenation',
  'regrowth',
  'power_word_shield',
]);

// -------------------------------------------------------------------- gear

// Current best-in-slot: unlike nythraxis_matrix.ts this INCLUDES the Nythraxis
// raid drops (the question is "how strong is a fully geared healer today").
function statScore(item: ItemDef, spec: Spec): number {
  const s = item.stats ?? {};
  const weapon = item.weapon ? (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed : 0;
  if (spec.kind === 'healer')
    return (
      weapon + (s.int ?? 0) * 5.4 + (s.spi ?? 0) * 4.4 + (s.sta ?? 0) * 0.8 + (s.armor ?? 0) * 0.004
    );
  if (spec.kind === 'caster')
    return (
      weapon * 2 +
      (s.int ?? 0) * 4.6 +
      (s.spi ?? 0) * 1.8 +
      (s.sta ?? 0) * 0.6 +
      (s.armor ?? 0) * 0.003
    );
  // Tank: max-EHP pick (stamina first, armor as tiebreak). Reproduces the
  // floors-test reference warrior kit (2861 armor / 2762 hp base); the old
  // armor-heavy weights traded 310 hp away for armor the fights never repaid.
  return (s.sta ?? 0) * 100 + (s.armor ?? 0) * 0.1 + weapon * 0.01;
}

const ARMOR_SLOTS: EquipSlot[] = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];

function equipCandidates(spec: Spec, filter: (item: ItemDef) => boolean): ItemDef[] {
  return Object.values(ITEMS)
    .filter(
      (item) =>
        (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand') &&
        canEquipItem(spec.cls, item) &&
        filter(item),
    )
    .sort((a, b) => statScore(b, spec) - statScore(a, spec));
}

function give(sim: Sim, pid: number, itemId: string, slot?: EquipSlot) {
  sim.addItem(itemId, 1, pid);
  if (slot) sim.equipItemToSlot(itemId, slot, pid);
  else sim.equipItem(itemId, pid);
}

function equipBest(sim: Sim, pid: number, spec: Spec) {
  for (const slot of ARMOR_SLOTS) {
    const item = equipCandidates(spec, (i) => i.slot === slot)[0];
    if (item) give(sim, pid, item.id);
  }
  const rings = equipCandidates(spec, (i) => i.slot === 'ring').slice(0, 2);
  if (rings[0]) give(sim, pid, rings[0].id, 'ring1');
  if (rings[1]) give(sim, pid, rings[1].id, 'ring2');
  // Weapons: best two-hander vs best one-hand + offhand (orb or shield).
  const twoHand = equipCandidates(
    spec,
    (i) => i.slot === 'mainhand' && i.kind === 'weapon' && i.weapon?.hand === 'twohand',
  )[0] as (ItemDef & { weapon?: { hand?: string } }) | undefined;
  const oneHand = equipCandidates(
    spec,
    (i) => i.slot === 'mainhand' && i.kind === 'weapon' && i.weapon?.hand !== 'twohand',
  )[0];
  const offhand = equipCandidates(spec, (i) => i.slot === 'offhand')[0];
  const comboScore =
    (oneHand ? statScore(oneHand, spec) : 0) + (offhand ? statScore(offhand, spec) : 0);
  const twoHandScore = twoHand ? statScore(twoHand, spec) : 0;
  if (comboScore >= twoHandScore) {
    if (oneHand) give(sim, pid, oneHand.id);
    if (offhand) give(sim, pid, offhand.id);
  } else if (twoHand) {
    give(sim, pid, twoHand.id);
  }
}

function ensureTalents(sim: Sim, pid: number, spec: Spec) {
  const check = validateAllocation(spec.cls, spec.talents, MAX_LEVEL);
  if (!check.ok) console.warn(`invalid talents for ${spec.key}: ${check.reason}`);
  if (!sim.applyTalents(spec.talents, pid)) {
    console.warn(`applyTalents rejected build for ${spec.key}, using default`);
    sim.applyTalents(defaultBuild(spec.cls, MAX_LEVEL), pid);
  }
}

// --------------------------------------------------------------- sim helpers

export function teleport(sim: Sim, id: number, x: number, z: number) {
  const e = must(sim.entities.get(id), `entity ${id}`);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

export function face(source: Entity, target: Entity) {
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  source.prevFacing = source.facing;
}

export function auraActive(entity: Entity, id: string, sourceId?: number): boolean {
  return entity.auras.some(
    (a) => a.id === id && (sourceId === undefined || a.sourceId === sourceId) && a.remaining > 0.5,
  );
}

export function cast(sim: Sim, pid: number, targetId: number, ability: string): boolean {
  const p = must(sim.entities.get(pid), `entity ${pid}`);
  if (p.dead || p.castingAbility) return false;
  p.targetId = targetId;
  const target = sim.entities.get(targetId);
  if (target) face(p, target);
  const before = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  sim.castAbility(ability, pid);
  const after = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  return before !== after;
}

export function healTick(
  sim: Sim,
  healerPid: number,
  target: Entity,
  spec: Spec,
  priority: string[],
) {
  const h = must(sim.entities.get(healerPid), `healer entity ${healerPid}`);
  if (h.dead || h.castingAbility) return;
  if (spec.emergencyMana && h.resource < h.maxResource * 0.25) {
    if (cast(sim, healerPid, healerPid, spec.emergencyMana)) return;
  }
  for (const ability of priority) {
    if (HOT_OR_SHIELD_GUARD.has(ability) && auraActive(target, ability, h.id)) continue;
    if (cast(sim, healerPid, target.id, ability)) return;
  }
}

export function addSpecPlayer(sim: Sim, spec: Spec, name: string): number {
  const pid = sim.addPlayer(spec.cls, name);
  sim.setPlayerLevel(MAX_LEVEL, pid);
  ensureTalents(sim, pid, spec);
  equipBest(sim, pid, spec);
  return pid;
}

type SimInner = { addEntity(e: Entity): void };

function spawnHeroicMob(
  sim: Sim,
  mobId: string,
  dungeonId: string,
  at: { x: number; z: number },
  role?: HeroicSpawnRole,
): Entity {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], dungeonId, 'heroic', role);
  const mob = createMob(sim.nextId++, template, template.maxLevel, {
    x: at.x,
    y: groundHeight(at.x, at.z, sim.cfg.seed),
    z: at.z,
  });
  mob.hostile = true;
  // Entity-level stamping: mechanic (aoePulse/stomp/bigCast) multipliers,
  // heroic charge activation, and boss CC immunity live on the ENTITY, not
  // the template. Without this, boss mechanics fire at base damage.
  applyDungeonMobTuning(mob, dungeonId, 'heroic', role);
  (sim as unknown as SimInner).addEntity(mob);
  return mob;
}

// Full engage once at spawn; per-tick we only re-pin threat so the mob's
// attack state machine is never reset mid-swing.
function engage(mob: Entity, tank: Entity) {
  mob.inCombat = true;
  mob.aiState = 'attack';
  pinThreat(mob, tank);
}

function pinThreat(mob: Entity, tank: Entity) {
  mob.aggroTargetId = tank.id;
  mob.threat.set(tank.id, 1e9);
}

// Belt and braces: nothing else should live near the arena, but if a wanderer
// strays in, drop it so it cannot pollute the measurement.
function sweepForeignMobs(sim: Sim, keep: Set<number>) {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || keep.has(e.id) || e.dead) continue;
    const dx = e.pos.x - ARENA.x;
    const dz = e.pos.z - ARENA.z;
    if (dx * dx + dz * dz < 150 * 150) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

// -------------------------------------------------------------------- stats

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  return {
    mean: round1(mean),
    p10: round1(percentile(sorted, 10)),
    p50: round1(percentile(sorted, 50)),
    p90: round1(percentile(sorted, 90)),
    n: sorted.length,
  };
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ------------------------------------------------------------------ bench A

type HealerBenchRun = {
  burstHps: number;
  sustainHps: number;
  ttoomSeconds: number | null;
  healingToOom: number;
  castsByAbility: Record<string, number>;
  healingByAbility: Record<string, number>;
};

type HealerProfile = {
  maxMana: number;
  maxHp: number;
  spellPower: number;
  int: number;
  spi: number;
};

function runHealerBench(spec: Spec, seed: number): { run: HealerBenchRun; profile: HealerProfile } {
  const priority = (spec.healPriority ?? []).filter((a) => !spec.benchExclude?.includes(a));
  const modes: { topUp: boolean; seconds: number }[] = [
    { topUp: true, seconds: BURST_SECONDS },
    { topUp: false, seconds: SUSTAIN_SECONDS },
  ];
  let burstHps = 0;
  let sustainHps = 0;
  let ttoom: number | null = null;
  let healingToOom = 0;
  const castsByAbility: Record<string, number> = {};
  const healingByAbility: Record<string, number> = {};
  let profile: HealerProfile | null = null;

  for (const mode of modes) {
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
    const healerPid = addSpecPlayer(sim, spec, 'Healer');
    const patientPid = sim.addPlayer('warrior', 'Patient');
    sim.setPlayerLevel(MAX_LEVEL, patientPid);
    teleport(sim, healerPid, ARENA.x, ARENA.z);
    teleport(sim, patientPid, ARENA.x, ARENA.z + 5);
    const healer = must(sim.entities.get(healerPid), `healer entity ${healerPid}`);
    const patient = must(sim.entities.get(patientPid), `patient entity ${patientPid}`);
    // A bottomless wound: heals never clamp against missing HP, HoTs always tick.
    patient.maxHp = 5e8;
    profile = {
      maxMana: healer.maxResource,
      maxHp: healer.maxHp,
      spellPower: healer.spellPower,
      int: healer.stats.int,
      spi: healer.stats.spi,
    };
    const known = sim.meta(healerPid)?.known ?? [];
    const minCost = Math.min(
      ...priority.map((a) => known.find((k) => k.def.id === a)?.cost ?? Number.POSITIVE_INFINITY),
    );
    let healed = 0;
    const ticks = mode.seconds * 20;
    for (let tick = 0; tick < ticks; tick++) {
      patient.hp = Math.round(patient.maxHp / 2);
      if (mode.topUp) healer.resource = healer.maxResource;
      healTick(sim, healerPid, patient, spec, priority);
      const events = sim.tick();
      for (const event of events) {
        if (event.type === 'heal2' && event.sourceId === healerPid) {
          healed += event.amount;
          if (!mode.topUp) {
            healingByAbility[event.ability] = (healingByAbility[event.ability] ?? 0) + event.amount;
          }
        }
        if (event.type === 'castStart' && event.entityId === healerPid && !mode.topUp) {
          castsByAbility[event.ability] = (castsByAbility[event.ability] ?? 0) + 1;
        }
      }
      if (!mode.topUp && ttoom === null && !healer.castingAbility && healer.resource < minCost) {
        ttoom = tick / 20;
        healingToOom = healed;
      }
    }
    if (mode.topUp) burstHps = healed / mode.seconds;
    else sustainHps = healed / mode.seconds;
  }
  return {
    run: {
      burstHps,
      sustainHps,
      ttoomSeconds: ttoom,
      healingToOom,
      castsByAbility,
      healingByAbility,
    },
    profile: must(profile, 'healer profile'),
  };
}

// ------------------------------------------------------------------ bench B

type Encounter = {
  key: string;
  dungeon: string;
  spawn: [string, number][];
  role?: HeroicSpawnRole;
  note?: string;
};

const ENCOUNTERS: Encounter[] = [
  { key: 'crypt_trash_x3_shambler', dungeon: 'hollow_crypt', spawn: [['crypt_shambler', 3]] },
  { key: 'crypt_boss_morthen', dungeon: 'hollow_crypt', spawn: [['morthen', 1]] },
  { key: 'bastion_boss_vael', dungeon: 'sunken_bastion', spawn: [['vael_the_mistcaller', 1]] },
  { key: 'temple_boss_ysolei', dungeon: 'drowned_temple', spawn: [['ysolei', 1]] },
  {
    key: 'sanctum_trash_2boneguard_1drakonid',
    dungeon: 'gravewyrm_sanctum',
    spawn: [
      ['sanctum_boneguard', 2],
      ['sanctum_drakonid', 1],
    ],
  },
  {
    key: 'sanctum_midboss_korgath',
    dungeon: 'gravewyrm_sanctum',
    spawn: [['korgath_the_bound', 1]],
  },
  {
    key: 'sanctum_boss_korzul',
    dungeon: 'gravewyrm_sanctum',
    spawn: [['korzul_the_gravewyrm', 1]],
  },
  {
    key: 'raid_boss_nythraxis_melee_only',
    dungeon: 'nythraxis_boss_arena',
    spawn: [['nythraxis_scourge_of_thornpeak', 1]],
    note: 'standalone spawn: encounter-script mechanics (Soul Rend etc.) do not run',
  },
];

type IntakeRun = {
  dtps: number;
  totalDamage: number;
  biggestHit: number;
  hits: number;
  avoided: number;
  tankArmor: number;
  tankMaxHp: number;
};

// The buff layers a real group runs on its tank: Litany of Resolve (+5% sta,
// priest party buff) and Elixir of the Bear (+12 sta). Probe: 2762 base kit
// to 3072 buffed; enchant/masterwork rolled stats (unmodeled) add more.
export function applyTankRaidBuffs(sim: Sim, pid: number) {
  const tank = must(sim.entities.get(pid), `tank entity ${pid}`);
  sim.ctx.applyAura(tank, {
    id: 'bench_litany',
    name: 'Litany of Resolve',
    kind: 'buff_sta_pct',
    remaining: 1800,
    duration: 1800,
    value: 5,
    sourceId: tank.id,
    school: 'holy',
  });
  sim.ctx.applyAura(tank, {
    id: 'bench_elixir',
    name: 'Might of the Bear',
    kind: 'buff_sta',
    remaining: 900,
    duration: 900,
    value: 12,
    sourceId: tank.id,
    school: 'nature',
  });
  sim.ctx.recalcPlayer(tank);
  tank.hp = tank.maxHp;
}

function setupTank(sim: Sim): { pid: number; tank: Entity } {
  const pid = addSpecPlayer(sim, TANK_SPEC, 'Tank');
  teleport(sim, pid, ARENA.x, ARENA.z);
  const tank = must(sim.entities.get(pid), `tank entity ${pid}`);
  for (const ability of TANK_SPEC.setup ?? []) cast(sim, pid, pid, ability);
  applyTankRaidBuffs(sim, pid);
  return { pid, tank };
}

function spawnEncounter(sim: Sim, encounter: Encounter, tank: Entity): Entity[] {
  const mobs: Entity[] = [];
  let i = 0;
  for (const [mobId, count] of encounter.spawn) {
    for (let c = 0; c < count; c++) {
      const angle = (Math.PI * 2 * i) / 6;
      const mob = spawnHeroicMob(
        sim,
        mobId,
        encounter.dungeon,
        {
          x: ARENA.x + Math.sin(angle) * (MELEE_RANGE - 1),
          z: ARENA.z + Math.cos(angle) * (MELEE_RANGE - 1),
        },
        encounter.role,
      );
      engage(mob, tank);
      mobs.push(mob);
      i++;
    }
  }
  face(tank, mobs[0]);
  return mobs;
}

function runIntakeBench(encounter: Encounter, seed: number): IntakeRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const { pid, tank } = setupTank(sim);
  const mobs = spawnEncounter(sim, encounter, tank);
  const keep = new Set(mobs.map((m) => m.id));
  let total = 0;
  let biggest = 0;
  let hits = 0;
  let avoided = 0;
  const ticks = INTAKE_SECONDS * 20;
  for (let tick = 0; tick < ticks; tick++) {
    tank.hp = tank.maxHp; // immortal probe: measure the full distribution
    for (const mob of mobs) if (!mob.dead) pinThreat(mob, tank);
    sim.startAutoAttack(pid);
    const events = sim.tick();
    for (const event of events) {
      if (event.type !== 'damage' || event.targetId !== pid) continue;
      if (event.kind === 'hit') {
        total += event.amount;
        biggest = Math.max(biggest, event.amount);
        hits++;
      } else if (event.kind === 'dodge' || event.kind === 'parry' || event.kind === 'miss') {
        avoided++;
      }
    }
    if (tick % 40 === 0) sweepForeignMobs(sim, keep);
  }
  return {
    dtps: total / INTAKE_SECONDS,
    totalDamage: total,
    biggestHit: biggest,
    hits,
    avoided,
    tankArmor: tank.stats.armor,
    tankMaxHp: tank.maxHp,
  };
}

// ------------------------------------------------------------------ bench C

type SurvivalRun = {
  tankDeathSeconds: number | null;
  healerOomSeconds: (number | null)[];
  tankDamageTaken: number;
  tankHealingReceived: number;
  seconds: number;
};

function runSurvival(encounter: Encounter, healerSpecs: Spec[], seed: number): SurvivalRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const { pid: tankPid, tank } = setupTank(sim);
  const healerPids = healerSpecs.map((spec, i) => {
    const pid = addSpecPlayer(sim, spec, `Healer${i}`);
    teleport(sim, pid, ARENA.x + 20 + i * 3, ARENA.z + 20);
    return pid;
  });
  // Pre-pull: real groups roll HoTs and shields on the tank before the first
  // swing. Only the guarded pre-castable abilities apply at full HP.
  const PREPULL_TICKS = 6 * 20;
  for (let t0 = 0; t0 < PREPULL_TICKS; t0++) {
    for (let i = 0; i < healerPids.length; i++) {
      const pre = (healerSpecs[i].healPriority ?? []).filter((a) => HOT_OR_SHIELD_GUARD.has(a));
      if (pre.length) healTick(sim, healerPids[i], tank, healerSpecs[i], pre);
    }
    sim.tick();
  }
  const mobs = spawnEncounter(sim, encounter, tank);
  const keep = new Set(mobs.map((m) => m.id));
  const oom: (number | null)[] = healerSpecs.map(() => null);
  let tankDeath: number | null = null;
  let damageTaken = 0;
  let healingReceived = 0;
  const ticks = SURVIVAL_CAP_SECONDS * 20;
  let tick = 0;
  for (; tick < ticks; tick++) {
    for (const mob of mobs) if (!mob.dead) pinThreat(mob, tank);
    sim.startAutoAttack(tankPid);
    for (let i = 0; i < healerPids.length; i++) {
      const healer = must(sim.entities.get(healerPids[i]), `healer entity ${healerPids[i]}`);
      if (tank.hp < tank.maxHp) {
        healTick(sim, healerPids[i], tank, healerSpecs[i], healerSpecs[i].healPriority ?? []);
      }
      if (oom[i] === null && !healer.castingAbility && healer.resource < 25) oom[i] = tick / 20;
    }
    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'damage' && event.targetId === tankPid && event.kind === 'hit')
        damageTaken += event.amount;
      if (event.type === 'heal2' && event.targetId === tankPid) healingReceived += event.amount;
      if (event.type === 'death' && event.entityId === tankPid) tankDeath = tick / 20;
    }
    if (tankDeath !== null) break;
    if (tick % 40 === 0) sweepForeignMobs(sim, keep);
  }
  return {
    tankDeathSeconds: tankDeath,
    healerOomSeconds: oom,
    tankDamageTaken: damageTaken,
    tankHealingReceived: healingReceived,
    seconds: Math.max(1 / 20, tick / 20),
  };
}

// -------------------------------------------------------------------- main

function main() {
  const startedAt = Date.now();
  console.log(
    `healing monte carlo: runs=${RUNS} burst=${BURST_SECONDS}s sustain=${SUSTAIN_SECONDS}s ` +
      `intake=${INTAKE_SECONDS}s survivalCap=${SURVIVAL_CAP_SECONDS}s`,
  );

  // Bench A: healer throughput.
  const healerRows: Record<string, ReturnType<typeof summarize> & Record<string, unknown>> = {};
  const healerProfiles: Record<string, HealerProfile> = {};
  const healerRuns: Record<string, HealerBenchRun[]> = {};
  for (const spec of HEALER_SPECS) {
    const runs: HealerBenchRun[] = [];
    let profile: HealerProfile | null = null;
    for (let r = 0; r < RUNS; r++) {
      const out = runHealerBench(spec, BASE_SEED + r * 7919);
      runs.push(out.run);
      profile = out.profile;
    }
    healerRuns[spec.key] = runs;
    healerProfiles[spec.key] = must(profile, `profile for ${spec.key}`);
    const burst = summarize(runs.map((r) => r.burstHps));
    const sustain = summarize(runs.map((r) => r.sustainHps));
    const ttoom = summarize(runs.map((r) => r.ttoomSeconds ?? SUSTAIN_SECONDS));
    healerRows[spec.key] = {
      ...burst,
      burst,
      sustain,
      ttoom,
    };
    console.log(
      `A ${spec.key.padEnd(20)} burst ${burst.p50.toFixed(1).padStart(6)} hps  ` +
        `sustain ${sustain.p50.toFixed(1).padStart(6)} hps  ttoom ${ttoom.p50}s  ` +
        `mana ${must(profile, `profile for ${spec.key}`).maxMana} sp ${must(profile, `profile for ${spec.key}`).spellPower}`,
    );
  }

  // Bench B: heroic intake.
  const intakeRows: Record<string, Record<string, unknown>> = {};
  for (const encounter of ENCOUNTERS) {
    const runs: IntakeRun[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(runIntakeBench(encounter, BASE_SEED + r * 104729));
    const dtps = summarize(runs.map((r) => r.dtps));
    const biggest = Math.max(...runs.map((r) => r.biggestHit));
    const avoidance = summarize(
      runs.map((r) => (100 * r.avoided) / Math.max(1, r.hits + r.avoided)),
    );
    intakeRows[encounter.key] = {
      dtps,
      biggestHit: biggest,
      avoidancePct: avoidance,
      tankArmor: runs[0].tankArmor,
      tankMaxHp: runs[0].tankMaxHp,
      note: encounter.note,
    };
    console.log(
      `B ${encounter.key.padEnd(34)} dtps ${dtps.p50.toFixed(0).padStart(5)} ` +
        `(p10 ${dtps.p10.toFixed(0)}, p90 ${dtps.p90.toFixed(0)})  ` +
        `maxhit ${biggest}  avoid ${avoidance.p50}%`,
    );
  }

  // Bench C: survival, every healer vs the softest and hardest five-man boss
  // plus the trash pack, and a two-healer variant on both bosses.
  const survivalCells: {
    key: string;
    encounter: string;
    healers: string[];
    runs: SurvivalRun[];
  }[] = [];
  const cEncounters = ENCOUNTERS.filter((e) =>
    [
      'crypt_boss_morthen',
      'bastion_boss_vael',
      'temple_boss_ysolei',
      'sanctum_midboss_korgath',
      'sanctum_boss_korzul',
      'crypt_trash_x3_shambler',
    ].includes(e.key),
  );
  for (const encounter of cEncounters) {
    for (const spec of HEALER_SPECS) {
      const runs: SurvivalRun[] = [];
      for (let r = 0; r < RUNS; r++)
        runs.push(runSurvival(encounter, [spec], BASE_SEED + r * 15485863));
      survivalCells.push({
        key: `${encounter.key}__${spec.key}`,
        encounter: encounter.key,
        healers: [spec.key],
        runs,
      });
    }
  }
  for (const encounterKey of [
    'crypt_boss_morthen',
    'bastion_boss_vael',
    'temple_boss_ysolei',
    'sanctum_midboss_korgath',
    'sanctum_boss_korzul',
  ]) {
    const encounter = must(
      ENCOUNTERS.find((e) => e.key === encounterKey),
      `encounter ${encounterKey}`,
    );
    const duo = [HEALER_SPECS[0], HEALER_SPECS[3]]; // holy priest + resto shaman
    const runs: SurvivalRun[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(runSurvival(encounter, duo, BASE_SEED + r * 32452843));
    survivalCells.push({
      key: `${encounter.key}__duo_priest_shaman`,
      encounter: encounter.key,
      healers: duo.map((d) => d.key),
      runs,
    });
  }
  const survivalRows: Record<string, Record<string, unknown>> = {};
  for (const cell of survivalCells) {
    const deaths = cell.runs.filter((r) => r.tankDeathSeconds !== null);
    const deathTimes = summarize(deaths.map((r) => must(r.tankDeathSeconds, 'tankDeathSeconds')));
    const survivedPct = round1((100 * (cell.runs.length - deaths.length)) / cell.runs.length);
    const dtps = summarize(cell.runs.map((r) => r.tankDamageTaken / r.seconds));
    const hps = summarize(cell.runs.map((r) => r.tankHealingReceived / r.seconds));
    survivalRows[cell.key] = {
      survivedPct,
      tankDeathSeconds: deathTimes,
      effectiveDtps: dtps,
      effectiveHps: hps,
    };
    const deathLabel = deaths.length === 0 ? 'n/a' : `${deathTimes.p50}s`;
    console.log(
      `C ${cell.key.padEnd(48)} survived ${String(survivedPct).padStart(5)}%  ` +
        `death p50 ${deathLabel}  dtps ${dtps.p50.toFixed(0)}  hps ${hps.p50.toFixed(0)}`,
    );
  }

  const report = {
    generated: new Date().toISOString(),
    config: {
      runs: RUNS,
      burstSeconds: BURST_SECONDS,
      sustainSeconds: SUSTAIN_SECONDS,
      intakeSeconds: INTAKE_SECONDS,
      survivalCapSeconds: SURVIVAL_CAP_SECONDS,
      baseSeed: BASE_SEED,
    },
    healerProfiles,
    healers: healerRows,
    healerRuns,
    intake: intakeRows,
    survival: survivalRows,
  };
  mkdirSync('tmp/healing_mc', { recursive: true });
  writeFileSync('tmp/healing_mc/report.json', JSON.stringify(report, null, 2));
  console.log(
    `wrote tmp/healing_mc/report.json in ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
}

// Only run the benches when invoked directly; healing_montecarlo_raid.ts
// imports the specs and helpers above without triggering a run.
if (process.argv[1]?.includes('healing_montecarlo.ts')) main();
