// Monte Carlo: NORMAL Gravewyrm Sanctum vs a FRESH level-20 group (the
// clearability companion to scripts/healing_montecarlo.ts, which benches
// best-in-slot groups vs heroics). Drives the REAL Sim: freshly-capped tanks
// (quest greens/blues, no epics, no heroic variants) against normal-Sanctum
// transformed mobs, one seeded Sim per run, so variance comes from real
// crit/miss/dodge/parry rolls.
//
// Three benches:
//   A) intake: per-hit damage distribution and DTPS on each committed tank
//      (prot warrior, protection paladin, feral druid) from every Sanctum
//      encounter shape, both sides pinned to full HP so the distribution is
//      not censored by death, enrage, or summon thresholds
//   B) survival: fresh tank + fresh healer + a modeled fresh-DPS drain runs
//      the real fight (enrage fires, Velkhar's add waves spawn tuned at his
//      66%/33% thresholds): cleared-vs-tank-death outcomes
//   C) solo ceiling (economy guard): DTPS on a best-in-slot max-EHP warrior,
//      compared against the ~140 hps self-heal ceiling of the strongest solo
//      archetype, so the retune provably keeps solo boss-farming dead
//
// Run: npx tsx scripts/sanctum_fresh_montecarlo.ts [--runs N] [--quick]
// Writes tmp/sanctum_mc/report.json and prints the digest tables.

import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultBuild, validateAllocation } from '../src/sim/content/talents';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { canEquipItem } from '../src/sim/equipment_rules';
import {
  applyDungeonMobTuning,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  type EquipSlot,
  type ItemDef,
  MAX_LEVEL,
  MELEE_RANGE,
} from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import {
  applyTankRaidBuffs,
  cast,
  face,
  HEALER_SPECS,
  healTick,
  round1,
  type Spec,
  summarize,
  teleport,
} from './healing_montecarlo';

function must<T>(value: T | undefined | null, label = 'expected value'): T {
  if (value === undefined || value === null) throw new Error(`must: ${label} was missing`);
  return value;
}

// ---------------------------------------------------------------- CLI / knobs

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const runsFlag = args.indexOf('--runs');
const RUNS = runsFlag >= 0 ? Number(args[runsFlag + 1]) : QUICK ? 2 : 8;
const INTAKE_SECONDS = QUICK ? 20 : 60;
const SURVIVAL_CAP_SECONDS = QUICK ? 60 : 240;
const BASE_SEED = 424200;

const SANCTUM = 'gravewyrm_sanctum';
const ARENA = { x: -2000, z: 3000 };

// Three fresh level-20 damage dealers focus-killing alongside the tank. A
// best-in-slot fire mage sustains ~233 dps (healing MC raid bench); fresh
// greens/blues players land well under half that.
const GROUP_DPS = 240;
// Three-player composition (2026-07-26): tank + healer + ONE dps at the same
// modeled 80 per head (the tank's own swings are real sim damage on top).
// The 2026-07-26 pressure pass exists because a real fresh 3-man cleared the
// first v0.30 floors without pressure; this bench keeps that composition
// honest instead of only pricing the 5-man drain.
const GROUP_DPS_3MAN = 80;
// The strongest solo archetype's sustained self-heal (the solo economy line
// documented in tests/gravewyrm_normal_tuning.test.ts).
const SOLO_SELF_HEAL_CEILING = 140;

// ------------------------------------------------------------------- specs

const TANK_SPECS: Spec[] = [
  {
    key: 'prot_warrior',
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
  },
  {
    key: 'protection_paladin',
    cls: 'paladin',
    kind: 'tank',
    talents: {
      spec: 'protection',
      rows: {
        5: 'pal_r5_crusaders_zeal',
        8: 'pal_r8_consecrated_ground',
        11: 'pal_r11_guardians_favor',
        14: 'pal_r14_righteous_cause',
        17: 'pal_r17_ardent_defender',
        20: 'pal_r20_avenging_wrath',
      },
    },
    setup: [],
  },
  {
    key: 'feral_druid',
    cls: 'druid',
    kind: 'tank',
    talents: {
      spec: 'feral',
      rows: {
        5: 'dru_r5_ferocity',
        8: 'dru_r8_brutal_bash',
        11: 'dru_r11_furor',
        14: 'dru_r14_savage_fury',
        17: 'dru_r17_survival_of_the_fittest',
        20: 'dru_r20_berserk',
      },
    },
    setup: ['bear_form'],
  },
];

// Fresh healer for the survival bench: restoration shaman, the strongest
// sustain healer (healing MC bench A), re-geared to the fresh tier below.
const FRESH_HEALER = must(
  HEALER_SPECS.find((s) => s.key === 'restoration_shaman'),
  'restoration_shaman spec',
);

// -------------------------------------------------------------------- gear

// 'fresh': what a freshly-capped 20 can wear out of questing and normal
// leveling drops: no epics, no legendaries, no heroic-minted variants.
// 'bis': everything, the healing MC best-in-slot tier (solo ceiling bench).
type KitTier = 'fresh' | 'bis';

function tierAllows(tier: KitTier, item: ItemDef): boolean {
  if (tier === 'bis') return true;
  if (item.quality === 'epic' || item.quality === 'legendary') return false;
  if (item.id.startsWith('heroic_')) return false;
  return true;
}

function statScore(item: ItemDef, spec: Spec): number {
  const s = item.stats ?? {};
  const weapon = item.weapon ? (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed : 0;
  if (spec.kind === 'healer')
    return (
      weapon + (s.int ?? 0) * 5.4 + (s.spi ?? 0) * 4.4 + (s.sta ?? 0) * 0.8 + (s.armor ?? 0) * 0.004
    );
  // Tank: max-EHP pick (stamina first, armor as tiebreak), the same weighting
  // that reproduces the floors-test reference warrior at the 'bis' tier.
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

function equipCandidates(spec: Spec, tier: KitTier, filter: (item: ItemDef) => boolean): ItemDef[] {
  return Object.values(ITEMS)
    .filter(
      (item) =>
        (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand') &&
        canEquipItem(spec.cls, item) &&
        tierAllows(tier, item) &&
        filter(item),
    )
    .sort((a, b) => statScore(b, spec) - statScore(a, spec));
}

function give(sim: Sim, pid: number, itemId: string, slot?: EquipSlot) {
  sim.addItem(itemId, 1, pid);
  if (slot) sim.equipItemToSlot(itemId, slot, pid);
  else sim.equipItem(itemId, pid);
}

function equipTier(sim: Sim, pid: number, spec: Spec, tier: KitTier) {
  for (const slot of ARMOR_SLOTS) {
    const item = equipCandidates(spec, tier, (i) => i.slot === slot)[0];
    if (item) give(sim, pid, item.id);
  }
  const rings = equipCandidates(spec, tier, (i) => i.slot === 'ring').slice(0, 2);
  if (rings[0]) give(sim, pid, rings[0].id, 'ring1');
  if (rings[1]) give(sim, pid, rings[1].id, 'ring2');
  const twoHand = equipCandidates(
    spec,
    tier,
    (i) => i.slot === 'mainhand' && i.kind === 'weapon' && i.weapon?.hand === 'twohand',
  )[0];
  const oneHand = equipCandidates(
    spec,
    tier,
    (i) => i.slot === 'mainhand' && i.kind === 'weapon' && i.weapon?.hand !== 'twohand',
  )[0];
  const offhand = equipCandidates(spec, tier, (i) => i.slot === 'offhand')[0];
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

function addTierPlayer(sim: Sim, spec: Spec, name: string, tier: KitTier): number {
  const pid = sim.addPlayer(spec.cls, name);
  sim.setPlayerLevel(MAX_LEVEL, pid);
  ensureTalents(sim, pid, spec);
  equipTier(sim, pid, spec, tier);
  return pid;
}

// --------------------------------------------------------------- sim helpers

type SimInner = { addEntity(e: Entity): void };

function spawnNormalMob(
  sim: Sim,
  mobId: string,
  at: { x: number; z: number },
  level?: number,
): Entity {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], SANCTUM, 'normal');
  const mob = createMob(sim.nextId++, template, level ?? template.maxLevel, {
    x: at.x,
    y: groundHeight(at.x, at.z, sim.cfg.seed),
    z: at.z,
  });
  mob.hostile = true;
  // Entity-level stamping: mechanic (stomp / Grave Inferno) multipliers live
  // on the ENTITY; without this boss mechanics fire at base damage.
  applyDungeonMobTuning(mob, SANCTUM, 'normal');
  (sim as unknown as SimInner).addEntity(mob);
  return mob;
}

function engage(mob: Entity, tank: Entity) {
  mob.inCombat = true;
  mob.aiState = 'attack';
  pinThreat(mob, tank);
}

function pinThreat(mob: Entity, tank: Entity) {
  mob.aggroTargetId = tank.id;
  mob.threat.set(tank.id, 1e9);
}

function sweepForeignMobs(sim: Sim, keep: Set<number>) {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || keep.has(e.id) || e.dead) continue;
    const dx = e.pos.x - ARENA.x;
    const dz = e.pos.z - ARENA.z;
    if (dx * dx + dz * dz < 150 * 150) {
      e.hp = 0;
      e.dead = true;
      // Bench kills bypass handleDeath, so park the in-place respawn
      // (mob/locomotion.ts revives a dead overworld mob when respawnTimer
      // runs out) the same way handleDeath does for scheduler-owned mobs.
      e.respawnTimer = Infinity;
    }
  }
}

type TankSetup = { pid: number; tank: Entity };

function setupTank(sim: Sim, spec: Spec, tier: KitTier, buffed: boolean): TankSetup {
  const pid = addTierPlayer(sim, spec, 'Tank', tier);
  teleport(sim, pid, ARENA.x, ARENA.z);
  const tank = must(sim.entities.get(pid), `tank entity ${pid}`);
  for (const ability of spec.setup ?? []) cast(sim, pid, pid, ability);
  sim.tick();
  sim.tick();
  if (buffed) applyTankRaidBuffs(sim, pid);
  tank.hp = tank.maxHp;
  return { pid, tank };
}

// -------------------------------------------------------------- encounters

type EncounterMob = { mobId: string; level?: number };
type Encounter = { key: string; mobs: EncounterMob[]; note?: string };

const ENCOUNTERS: Encounter[] = [
  {
    key: 'trash_2boneguard_1drakonid',
    mobs: [
      { mobId: 'sanctum_boneguard' },
      { mobId: 'sanctum_boneguard' },
      { mobId: 'sanctum_drakonid' },
    ],
    note: 'the standard three-elite pull, drakonid at its level-20 max roll',
  },
  {
    key: 'adds_3bonewalkers',
    mobs: [
      { mobId: 'raised_bonewalker' },
      { mobId: 'raised_bonewalker' },
      { mobId: 'raised_bonewalker' },
    ],
    note: "one of Velkhar's summon waves, alone",
  },
  { key: 'midboss_korgath', mobs: [{ mobId: 'korgath_the_bound' }] },
  { key: 'midboss_velkhar', mobs: [{ mobId: 'grand_necromancer_velkhar' }] },
  {
    key: 'velkhar_plus_3adds',
    mobs: [
      { mobId: 'grand_necromancer_velkhar' },
      { mobId: 'raised_bonewalker' },
      { mobId: 'raised_bonewalker' },
      { mobId: 'raised_bonewalker' },
    ],
    note: 'the mid-fight steady state while a wave is up',
  },
  { key: 'boss_korzul', mobs: [{ mobId: 'korzul_the_gravewyrm' }] },
];

function spawnEncounter(sim: Sim, encounter: Encounter, tank: Entity): Entity[] {
  const mobs: Entity[] = [];
  encounter.mobs.forEach((em, i) => {
    const angle = (Math.PI * 2 * i) / 6;
    const mob = spawnNormalMob(
      sim,
      em.mobId,
      {
        x: ARENA.x + Math.sin(angle) * (MELEE_RANGE - 1),
        z: ARENA.z + Math.cos(angle) * (MELEE_RANGE - 1),
      },
      em.level,
    );
    engage(mob, tank);
    mobs.push(mob);
  });
  face(tank, mobs[0]);
  return mobs;
}

// ------------------------------------------------------------------ bench A

type IntakeRun = {
  dtps: number;
  hits: number[];
  crits: number;
  avoided: number;
  byAbility: Record<string, { count: number; total: number; max: number }>;
  tankArmor: number;
  tankMaxHp: number;
};

function runIntake(spec: Spec, encounter: Encounter, seed: number, tier: KitTier): IntakeRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const { pid, tank } = setupTank(sim, spec, tier, tier === 'bis');
  const mobs = spawnEncounter(sim, encounter, tank);
  const keep = new Set(mobs.map((m) => m.id));
  const hits: number[] = [];
  let crits = 0;
  let avoided = 0;
  const byAbility: IntakeRun['byAbility'] = {};
  const ticks = INTAKE_SECONDS * 20;
  for (let tick = 0; tick < ticks; tick++) {
    tank.hp = tank.maxHp; // immortal probe: the full distribution, uncensored
    for (const mob of mobs) {
      if (mob.dead) continue;
      mob.hp = mob.maxHp; // pinned: no enrage, no summon thresholds, no death
      pinThreat(mob, tank);
    }
    sim.startAutoAttack(pid);
    const events = sim.tick();
    for (const event of events) {
      if (event.type !== 'damage' || event.targetId !== pid) continue;
      if (event.kind === 'hit') {
        hits.push(event.amount);
        if (event.crit) crits++;
        const label = event.ability ?? 'melee';
        let slot = byAbility[label];
        if (!slot) {
          slot = { count: 0, total: 0, max: 0 };
          byAbility[label] = slot;
        }
        slot.count++;
        slot.total += event.amount;
        slot.max = Math.max(slot.max, event.amount);
      } else {
        avoided++;
      }
    }
    if (tick % 40 === 0) sweepForeignMobs(sim, keep);
  }
  return {
    dtps: hits.reduce((a, b) => a + b, 0) / INTAKE_SECONDS,
    hits,
    crits,
    avoided,
    byAbility,
    tankArmor: tank.stats.armor,
    tankMaxHp: tank.maxHp,
  };
}

// ------------------------------------------------------------------ bench B

type SurvivalRun = {
  cleared: boolean;
  tankDeathSeconds: number | null;
  clearSeconds: number | null;
  healerOomSeconds: number | null;
  minTankHpFrac: number;
};

// Velkhar's real fight summons tuned waves at 66%/33%. Standalone arena
// spawns sit in no instance, so the sim's own spawnBossAdds path would mint
// UNTUNED adds; the bench pre-fires his thresholds and spawns the waves
// itself through the normal-Sanctum transform.
function runSurvival(
  spec: Spec,
  encounter: Encounter,
  seed: number,
  groupDps: number = GROUP_DPS,
): SurvivalRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const { pid: tankPid, tank } = setupTank(sim, spec, 'fresh', false);
  const healerPid = addTierPlayer(sim, FRESH_HEALER, 'Healer', 'fresh');
  teleport(sim, healerPid, ARENA.x + 20, ARENA.z + 20);
  const healer = must(sim.entities.get(healerPid), `healer entity ${healerPid}`);
  const mobs = spawnEncounter(sim, encounter, tank);
  const keep = new Set(mobs.map((m) => m.id));
  const velkhar = mobs.find((m) => m.templateId === 'grand_necromancer_velkhar');
  if (velkhar) velkhar.firedSummons = 2; // bench owns the waves (see above)
  const waveThresholds = velkhar ? [0.66, 0.33] : [];
  let wavesFired = 0;
  let tankDeath: number | null = null;
  let cleared: number | null = null;
  let healerOom: number | null = null;
  let minTankHpFrac = 1;
  const ticks = SURVIVAL_CAP_SECONDS * 20;
  for (let tick = 0; tick < ticks; tick++) {
    // The modeled DPS drain focus-kills adds first, then the pull in order.
    const alive = mobs.filter((m) => !m.dead);
    if (alive.length === 0) {
      cleared = tick / 20;
      break;
    }
    const adds = alive.filter((m) => m.templateId === 'raised_bonewalker');
    const killTarget = adds[0] ?? alive[0];
    killTarget.hp -= groupDps / 20;
    if (killTarget.hp <= 0) {
      killTarget.hp = 0;
      killTarget.dead = true;
      // Park the in-place respawn; without this the arena "corpse" revives
      // at full health ~25s later and the encounter never clears.
      killTarget.respawnTimer = Infinity;
    }
    if (velkhar && !velkhar.dead && wavesFired < waveThresholds.length) {
      const frac = velkhar.hp / Math.max(1, velkhar.maxHp);
      if (frac <= waveThresholds[wavesFired]) {
        wavesFired++;
        for (let k = 0; k < 3; k++) {
          const ang = (k / 3) * Math.PI * 2 + 0.7;
          const add = spawnNormalMob(sim, 'raised_bonewalker', {
            x: velkhar.pos.x + Math.sin(ang) * 3.5,
            z: velkhar.pos.z + Math.cos(ang) * 3.5,
          });
          engage(add, tank);
          mobs.push(add);
          keep.add(add.id);
        }
      }
    }
    for (const mob of mobs) if (!mob.dead) pinThreat(mob, tank);
    // Grave Inferno counterplay: the intended play is to walk out of the
    // true-radius ring while the boss channels (he is rooted and not
    // meleeing), so the bench tank does exactly that, at RUN speed from
    // melee range, which usually costs the small first pulse; the mobs walk
    // the tank back into contact after. Standing the full channel is the
    // failure case the mechanic multiplier exists to punish, not the
    // survival baseline.
    const channeler = mobs.find((m) => !m.dead && m.infernoRemaining > 0);
    if (channeler) {
      const ring = (MOBS[channeler.templateId]?.infernoChannel?.radius ?? 14) + 2;
      const dx = tank.pos.x - channeler.pos.x;
      const dz = tank.pos.z - channeler.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < ring) {
        const out = Math.min(ring, d + 7 / 20); // player RUN_SPEED per tick
        const scale = out / Math.max(0.5, d);
        tank.pos = {
          x: channeler.pos.x + dx * scale,
          y: tank.pos.y,
          z: channeler.pos.z + dz * scale,
        };
        tank.prevPos = { ...tank.pos };
      }
    }
    sim.startAutoAttack(tankPid);
    if (tank.hp < tank.maxHp) {
      healTick(sim, healerPid, tank, FRESH_HEALER, FRESH_HEALER.healPriority ?? []);
    }
    if (healerOom === null && !healer.castingAbility && healer.resource < 25) {
      healerOom = tick / 20;
    }
    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'death' && event.entityId === tankPid) tankDeath = tick / 20;
    }
    if (process.env.DEBUG_SURVIVAL && tick % 100 === 0) {
      const aliveNow = mobs.filter((m) => !m.dead);
      console.log(
        `  dbg t=${(tick / 20).toFixed(0)}s alive=${aliveNow.length} ` +
          `firstHp=${aliveNow[0] ? Math.round(aliveNow[0].hp) : 0} ` +
          `tankHp=${Math.round(tank.hp)}/${tank.maxHp} mana=${Math.round(healer.resource)} ` +
          `healerDead=${healer.dead}`,
      );
    }
    minTankHpFrac = Math.min(minTankHpFrac, Math.max(0, tank.hp) / tank.maxHp);
    if (tankDeath !== null) break;
    if (tick % 40 === 0) sweepForeignMobs(sim, keep);
  }
  return {
    cleared: cleared !== null,
    tankDeathSeconds: tankDeath,
    clearSeconds: cleared,
    healerOomSeconds: healerOom,
    minTankHpFrac: round1(minTankHpFrac * 100) / 100,
  };
}

// -------------------------------------------------------------------- main

function main() {
  const startedAt = Date.now();
  console.log(
    `sanctum fresh monte carlo: runs=${RUNS} intake=${INTAKE_SECONDS}s ` +
      `survivalCap=${SURVIVAL_CAP_SECONDS}s groupDps=${GROUP_DPS}`,
  );

  // Tank profiles at both tiers.
  const profiles: Record<string, Record<string, unknown>> = {};
  for (const spec of TANK_SPECS) {
    for (const tier of ['fresh', 'bis'] as KitTier[]) {
      const sim = new Sim({ seed: BASE_SEED, playerClass: 'warrior', noPlayer: true });
      const { tank } = setupTank(sim, spec, tier, false);
      profiles[`${spec.key}__${tier}`] = {
        maxHp: tank.maxHp,
        armor: tank.stats.armor,
        sta: tank.stats.sta,
      };
      console.log(
        `P ${spec.key.padEnd(20)} ${tier.padEnd(5)} hp ${String(tank.maxHp).padStart(5)} ` +
          `armor ${String(tank.stats.armor).padStart(5)}`,
      );
    }
  }

  // Bench A: fresh-tank intake per encounter.
  const intake: Record<string, Record<string, unknown>> = {};
  for (const spec of TANK_SPECS) {
    for (const encounter of ENCOUNTERS) {
      const runs: IntakeRun[] = [];
      for (let r = 0; r < RUNS; r++) {
        runs.push(runIntake(spec, encounter, BASE_SEED + r * 104729, 'fresh'));
      }
      const pool = runs[0].tankMaxHp;
      const allHits = runs.flatMap((r) => r.hits);
      const hitStats = summarize(allHits);
      const maxHit = allHits.length ? Math.max(...allHits) : 0;
      const dtps = summarize(runs.map((r) => r.dtps));
      const totalSwings = runs.reduce((a, r) => a + r.hits.length + r.avoided, 0);
      const avoidedPct = round1(
        (100 * runs.reduce((a, r) => a + r.avoided, 0)) / Math.max(1, totalSwings),
      );
      const byAbility: Record<string, { count: number; mean: number; max: number }> = {};
      for (const run of runs) {
        for (const [label, slot] of Object.entries(run.byAbility)) {
          let agg = byAbility[label];
          if (!agg) {
            agg = { count: 0, mean: 0, max: 0 };
            byAbility[label] = agg;
          }
          agg.count += slot.count;
          agg.mean += slot.total;
          agg.max = Math.max(agg.max, slot.max);
        }
      }
      for (const agg of Object.values(byAbility)) {
        agg.mean = round1(agg.mean / Math.max(1, agg.count));
      }
      intake[`${spec.key}__${encounter.key}`] = {
        pool,
        tankArmor: runs[0].tankArmor,
        hit: hitStats,
        maxHit,
        meanHitPctOfPool: round1((100 * hitStats.mean) / pool),
        maxHitPctOfPool: round1((100 * maxHit) / pool),
        dtps,
        avoidedPct,
        byAbility,
        note: encounter.note,
      };
      console.log(
        `A ${spec.key.padEnd(20)} ${encounter.key.padEnd(28)} hit p50 ${String(hitStats.p50).padStart(4)} ` +
          `(${round1((100 * hitStats.p50) / pool)}% pool) max ${String(maxHit).padStart(4)} ` +
          `(${round1((100 * maxHit) / pool)}%) dtps ${dtps.p50.toFixed(0).padStart(4)} avoid ${avoidedPct}%`,
      );
    }
  }

  // Bench B: survival (fresh tank + fresh resto shaman + modeled group dps).
  const survivalEncounters = ENCOUNTERS.filter((e) =>
    ['trash_2boneguard_1drakonid', 'midboss_korgath', 'midboss_velkhar', 'boss_korzul'].includes(
      e.key,
    ),
  );
  const survival: Record<string, Record<string, unknown>> = {};
  const survival3man: Record<string, Record<string, unknown>> = {};
  const comps: { label: string; dps: number; into: Record<string, Record<string, unknown>> }[] = [
    { label: 'B ', dps: GROUP_DPS, into: survival },
    { label: 'B3', dps: GROUP_DPS_3MAN, into: survival3man },
  ];
  for (const comp of comps) {
    for (const spec of TANK_SPECS) {
      for (const encounter of survivalEncounters) {
        const runs: SurvivalRun[] = [];
        for (let r = 0; r < RUNS; r++) {
          runs.push(runSurvival(spec, encounter, BASE_SEED + r * 15485863, comp.dps));
        }
        const clearedPct = round1((100 * runs.filter((r) => r.cleared).length) / runs.length);
        const deaths = runs.filter((r) => r.tankDeathSeconds !== null);
        const deathTimes = summarize(
          deaths.map((r) => must(r.tankDeathSeconds, 'tankDeathSeconds')),
        );
        const clearTimes = summarize(
          runs.filter((r) => r.clearSeconds !== null).map((r) => must(r.clearSeconds, 'clear')),
        );
        const minHp = summarize(runs.map((r) => r.minTankHpFrac * 100));
        comp.into[`${spec.key}__${encounter.key}`] = {
          clearedPct,
          tankDeaths: deaths.length,
          tankDeathSeconds: deathTimes,
          clearSeconds: clearTimes,
          minTankHpPct: minHp,
        };
        console.log(
          `${comp.label} ${spec.key.padEnd(20)} ${encounter.key.padEnd(28)} cleared ${String(clearedPct).padStart(5)}% ` +
            `deaths ${deaths.length}/${runs.length} clear p50 ${clearTimes.p50}s minHp p10 ${minHp.p10}%`,
        );
      }
    }
  }

  // Bench C: solo ceiling on the best-in-slot warrior (economy guard).
  const solo: Record<string, Record<string, unknown>> = {};
  const soloEncounters = ENCOUNTERS.filter((e) =>
    ['trash_2boneguard_1drakonid', 'midboss_korgath', 'midboss_velkhar', 'boss_korzul'].includes(
      e.key,
    ),
  );
  for (const encounter of soloEncounters) {
    const runs: IntakeRun[] = [];
    for (let r = 0; r < RUNS; r++) {
      runs.push(runIntake(TANK_SPECS[0], encounter, BASE_SEED + r * 32452843, 'bis'));
    }
    const dtps = summarize(runs.map((r) => r.dtps));
    solo[encounter.key] = {
      pool: runs[0].tankMaxHp,
      tankArmor: runs[0].tankArmor,
      dtps,
      soloSelfHealCeiling: SOLO_SELF_HEAL_CEILING,
      soloDies: dtps.p10 > SOLO_SELF_HEAL_CEILING,
    };
    console.log(
      `C ${encounter.key.padEnd(28)} bis-warrior dtps p50 ${dtps.p50.toFixed(0).padStart(4)} ` +
        `(p10 ${dtps.p10.toFixed(0)}) vs solo self-heal ${SOLO_SELF_HEAL_CEILING} hps -> ` +
        `${dtps.p10 > SOLO_SELF_HEAL_CEILING ? 'solo still dies' : 'SOLOABLE'}`,
    );
  }

  const report = {
    generated: new Date().toISOString(),
    config: {
      runs: RUNS,
      intakeSeconds: INTAKE_SECONDS,
      survivalCapSeconds: SURVIVAL_CAP_SECONDS,
      groupDps: GROUP_DPS,
      groupDps3man: GROUP_DPS_3MAN,
      baseSeed: BASE_SEED,
    },
    profiles,
    intake,
    survival,
    survival3man,
    solo,
  };
  mkdirSync('tmp/sanctum_mc', { recursive: true });
  writeFileSync('tmp/sanctum_mc/report.json', JSON.stringify(report, null, 2));
  console.log(
    `wrote tmp/sanctum_mc/report.json in ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
}

if (process.argv[1]?.includes('sanctum_fresh_montecarlo.ts')) main();
