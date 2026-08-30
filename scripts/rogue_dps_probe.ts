// Deterministic Rogue sustained-DPS probe for the v0.29 spec engines and rows.
// The reusable API runs in an empty ambient world so tests measure the Rogue
// rotation instead of paying for continent-wide AI. The CLI retains the full
// row sweep used for exploratory tuning.
//
// npx tsx scripts/rogue_dps_probe.ts

import type { TalentRowLevel } from '../src/sim/content/talents';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { equipReferenceEpicKitForDev } from '../src/sim/dev/bis_gear';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, EquipSlot, WorldContent } from '../src/sim/types';
import { anchorProbeInOpenField } from './probe_anchor';

export type RogueProbeSpec = 'assassination' | 'combat' | 'subtlety';
export type RogueProbeRow14 =
  | 'rog_r14_dusk_economy'
  | 'rog_r14_venom_dividend'
  | 'rog_r14_ceaseless_cuts';
export type RogueProbeRow20 = 'rog_r20_second_shadow' | 'rog_r20_deathmark';

export interface RogueProbeBuild {
  row14: RogueProbeRow14;
  row20: RogueProbeRow20;
}

export interface RogueDpsResult {
  spec: RogueProbeSpec;
  seconds: number;
  targetArmor: number;
  damage: number;
  dps: number;
  seeds: readonly number[];
  build: RogueProbeBuild;
  // The kit the probe actually equipped, so tests assert the band's gear
  // properties (epic-only, no legendary) on reality instead of on a function
  // the probe might silently stop calling.
  equipment: Readonly<Partial<Record<EquipSlot, string>>>;
}

type ProbeSim = Sim & {
  addEntity(entity: Entity): void;
};

const ROGUE_PROBE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const SPECS: RogueProbeSpec[] = ['assassination', 'combat', 'subtlety'];
const R14: RogueProbeRow14[] = [
  'rog_r14_dusk_economy',
  'rog_r14_venom_dividend',
  'rog_r14_ceaseless_cuts',
];
const R20: RogueProbeRow20[] = ['rog_r20_second_shadow', 'rog_r20_deathmark'];
const EXPLORATORY_SEEDS = [4242, 777, 1313, 99, 2024, 555, 31337, 8080] as const;

// La Luna's fight-6498 build, recorded here so the accepted balance fixture is
// reproducible rather than dependent on a live character save. The common rows
// establish the same engine-aware rotation used by the original tuning probe.
export const LA_LUNA_ROGUE_BUILD: RogueProbeBuild = {
  row14: 'rog_r14_ceaseless_cuts',
  row20: 'rog_r20_second_shadow',
};

export const LA_LUNA_ROGUE_ROWS: Partial<Record<TalentRowLevel, string>> = {
  5: 'rog_r5_killers_pace',
  8: 'rog_r8_borrowed_breath',
  11: 'rog_r11_marked_prey',
  14: LA_LUNA_ROGUE_BUILD.row14,
  17: 'rog_r17_flurry_of_knives',
  20: LA_LUNA_ROGUE_BUILD.row20,
};

export const ROGUE_BAND_FIXTURE = {
  seconds: 60,
  seeds: [4242, 777, 1313] as const,
  // The inert target keeps encounter mechanics out of a class-throughput
  // probe while taking the level-20 Nythraxis template's full 798 armor.
  targetArmor: Math.round(MOBS.nythraxis_scourge_of_thornpeak.armorPerLevel * 19),
  build: LA_LUNA_ROGUE_BUILD,
  rows: LA_LUNA_ROGUE_ROWS,
};

function talentRows(build: RogueProbeBuild): Partial<Record<TalentRowLevel, string>> {
  return {
    ...LA_LUNA_ROGUE_ROWS,
    14: build.row14,
    20: build.row20,
  };
}

function spawnTarget(sim: ProbeSim, armor: number): Entity {
  const player = sim.player;
  const target = createMob(93001, MOBS.training_dummy, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  target.hostile = true;
  target.aiState = 'idle';
  target.moveSpeed = 0;
  target.stats.armor = armor;
  target.maxHp = 100_000_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 100;
  sim.addEntity(target);
  sim.targetEntity(target.id);
  player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
  return target;
}

function castRotation(sim: Sim, spec: RogueProbeSpec): void {
  const player = sim.player;
  const sliceAndDiceUp = player.auras.some(
    (aura) => aura.kind === 'buff_haste' && aura.id === 'slice_and_dice',
  );
  const gloamArmed = (player.auras.find((aura) => aura.id === 'gloam')?.stacks ?? 0) >= 3;
  const veilstrikeUp = player.auras.some((aura) => aura.id === 'veilstrike');

  if (!player.cooldowns.has('adrenaline_rush')) sim.castAbility('adrenaline_rush');
  if (!player.cooldowns.has('flurry_of_knives')) sim.castAbility('flurry_of_knives');
  if (spec === 'assassination' && !player.cooldowns.has('cold_blood')) {
    sim.castAbility('cold_blood');
  }
  if (spec === 'combat' && !player.cooldowns.has('blade_flurry')) {
    sim.castAbility('blade_flurry');
  }

  if (spec === 'subtlety' && gloamArmed && !veilstrikeUp) {
    sim.castAbility('ambush');
    return;
  }
  if (
    spec === 'assassination' &&
    player.comboPoints < 5 &&
    !player.cooldowns.has('venom_dart') &&
    player.auras.some((aura) => aura.id === 'venom_ritual')
  ) {
    sim.castAbility('venom_dart');
  }

  const redline = player.auras.find((aura) => aura.id === 'redline');
  if (spec === 'subtlety' && veilstrikeUp && player.resource >= 60 && player.comboPoints <= 3) {
    sim.castAbility('cheap_shot');
  } else if (spec === 'combat' && redline) {
    const pips = redline.stacks ?? 1;
    const closing = redline.remaining < 1.6;
    if (player.comboPoints >= 5 && (pips >= 4 || closing)) sim.castAbility('eviscerate');
    else if (player.comboPoints >= 4 && closing) sim.castAbility('eviscerate');
    else sim.castAbility('sinister_strike');
  } else if (!sliceAndDiceUp && player.comboPoints >= 2) {
    sim.castAbility('slice_and_dice');
  } else if (player.comboPoints >= 5) {
    if (spec !== 'combat' || player.resource >= 70) sim.castAbility('eviscerate');
  } else {
    const builder =
      spec === 'subtlety'
        ? 'hemorrhage'
        : spec === 'assassination'
          ? 'backstab'
          : 'sinister_strike';
    sim.castAbility(builder);
    if (player.comboPoints === 0 && spec !== 'combat') sim.castAbility('sinister_strike');
  }
}

export function runRogueDpsProbe(
  spec: RogueProbeSpec,
  seed: number,
  seconds: number,
  targetArmor: number,
  build: RogueProbeBuild,
): RogueDpsResult {
  const sim = new Sim({
    seed,
    playerClass: 'rogue',
    autoEquip: false,
    world: ROGUE_PROBE_WORLD,
  }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.applyTalents({ spec, rows: talentRows(build) })) {
    throw new Error(`failed to apply ${spec} probe build`);
  }

  // The reference kit's epic-only scorer keeps the legendary this band
  // intentionally excludes out of the loadout. /dev bis no longer guarantees
  // that: it equips top-parse loadouts, legendaries included.
  if (equipReferenceEpicKitForDev(sim.ctx, sim.playerId) === 0) {
    throw new Error(`failed to equip ${spec} probe loadout`);
  }
  const equipment = { ...(sim.ctx.players.get(sim.playerId)?.equipment ?? {}) };

  const player = sim.player;
  player.resource = player.maxResource;
  sim.castAbility('deadly_poison');
  for (let tick = 0; tick < 40; tick++) sim.tick();

  const target = spawnTarget(sim, targetArmor);
  sim.castAbility('stealth');
  for (let tick = 0; tick < 25; tick++) sim.tick();
  player.resource = player.maxResource;
  sim.castAbility('cheap_shot');
  for (let tick = 0; tick < 5; tick++) sim.tick();

  sim.startAutoAttack();
  const startHp = target.hp;
  for (let tick = 0; tick < seconds * 20; tick++) {
    castRotation(sim, spec);
    sim.tick();
  }
  const damage = startHp - target.hp;
  return {
    spec,
    seconds,
    targetArmor,
    damage,
    dps: damage / seconds,
    seeds: [seed],
    build,
    equipment,
  };
}

export function averageRogueDps(
  spec: RogueProbeSpec,
  seeds: readonly number[],
  seconds: number,
  targetArmor: number,
  build: RogueProbeBuild,
): RogueDpsResult {
  if (seeds.length === 0) throw new Error('Rogue DPS probe requires at least one seed');
  const runs = seeds.map((seed) => runRogueDpsProbe(spec, seed, seconds, targetArmor, build));
  const damage = runs.reduce((sum, result) => sum + result.damage, 0) / runs.length;
  return {
    spec,
    seconds,
    targetArmor,
    damage,
    dps: damage / seconds,
    seeds: [...seeds],
    build,
    equipment: runs[0].equipment,
  };
}

if (process.argv[1]?.endsWith('rogue_dps_probe.ts')) {
  console.log('spec, r14, r20, dps');
  const results: RogueDpsResult[] = [];
  for (const spec of SPECS) {
    for (const row14 of R14) {
      for (const row20 of R20) {
        const result = averageRogueDps(spec, EXPLORATORY_SEEDS, 123, 0, { row14, row20 });
        results.push(result);
        console.log(
          `${spec}, ${row14.replace('rog_r14_', '')}, ${row20.replace('rog_r20_', '')}, ${result.dps.toFixed(1)}`,
        );
      }
    }
  }
  for (const spec of SPECS) {
    const best = results.filter((result) => result.spec === spec).sort((a, b) => b.dps - a.dps)[0];
    console.log(
      `BEST ${spec}: ${best.build.row14} + ${best.build.row20} = ${best.dps.toFixed(1)} dps`,
    );
  }
}
