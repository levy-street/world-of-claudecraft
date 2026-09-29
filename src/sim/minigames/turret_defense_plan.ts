// Resolves a Fire and Fly scenario against the real mob templates into a plan of
// plain numbers the engine reads: the tower's points, health from the shared mob
// formula (times the entry's scale), march speed from the template's own speed,
// size-class physics per kind, a fixed spawn order and an arrival pattern per
// wave. The plan reaches the client once per seat, so anything a scenario varies
// lives here, never in a constant both sides would have to agree on.

import { TURRET_DEFAULT_SCENARIO } from '../content/fire_and_fly_scenarios';
import {
  TURRET_BOWLING,
  TURRET_SIZE_CLASSES,
  TURRET_TEMPLATE_SIZES,
  TURRET_TIMING,
} from '../content/turret_defense';
import { MOBS } from '../data';
import { deepFreeze } from '../deep_freeze';
import { mobMaxHp } from '../entity';
import type {
  MobTemplate,
  TurretArrivalDef,
  TurretBarrelWaveDef,
  TurretBowlingDef,
  TurretMedalBars,
  TurretScenarioDef,
  TurretSizeClass,
  TurretWaveEntry,
} from '../types';
import { turretMedalBarPoints } from './turret_result';

export interface TurretKind {
  readonly templateId: string;
  readonly level: number;
  readonly sizeClass: TurretSizeClass;
  readonly maxHp: number;
  readonly marchSpeed: number;
  readonly mass: number;
  readonly radius: number;
  readonly breachValue: number;
  readonly height: number;
}

export interface TurretWavePlan {
  /** Kind indices in spawn order. */
  readonly spawns: readonly number[];
  readonly coreDamage: number;
  readonly gapMinTicks: number;
  readonly gapMaxTicks: number;
  readonly barrels: Readonly<TurretBarrelWaveDef>;
  readonly arrival: Readonly<TurretArrivalDef>;
}

/** Limited-weapon charges per run, 0 for none. */
export interface TurretArsenal {
  readonly shockwave: number;
  readonly fragmentation: number;
}

/** Deep-frozen when resolved: sessions and their views share one plan by reference. */
export interface TurretPlan {
  readonly scenarioId: string;
  /** Tower points at the start, and the most it can hold. */
  readonly integrity: number;
  /** The medal bars, as shares of `integrity` kept at a win (turret_result.ts). */
  readonly medals: Readonly<TurretMedalBars>;
  readonly arsenal: TurretArsenal;
  readonly kinds: readonly TurretKind[];
  readonly waves: readonly TurretWavePlan[];
  readonly bowling: Readonly<TurretBowlingDef>;
}

/**
 * Entry indices in spawn order: the ordinary entries interleaved evenly across
 * the wave (each entry's i-th monster at (i + 0.5) / count, ties in entry
 * order), then the boss-last entries.
 */
export function turretSpawnOrder(entries: readonly TurretWaveEntry[]): number[] {
  const slots: { at: number; entry: number }[] = [];
  entries.forEach((e, entry) => {
    if (e.bossLast) return;
    for (let i = 0; i < e.count; i++) slots.push({ at: (i + 0.5) / e.count, entry });
  });
  slots.sort((a, b) => a.at - b.at || a.entry - b.entry);
  const order = slots.map((s) => s.entry);
  entries.forEach((e, entry) => {
    if (e.bossLast) for (let i = 0; i < e.count; i++) order.push(entry);
  });
  return order;
}

/**
 * The most a plan may carry. The online client's `turp` decoder rejects a plan past
 * any of these (and the seat shows no HUD), so the resolver refuses to build one.
 */
export const TURRET_PLAN_LIMITS = {
  scenarioIdLength: 64,
  waves: 64,
  kinds: 64,
  spawnsPerWave: 256,
  integrity: 100_000,
  charges: 99,
  groupGapTicks: 20 * 60,
} as const;

/** Lowercase letters, digits and underscores, at most the id length. */
export function turretScenarioIdValid(id: string): boolean {
  return id.length <= TURRET_PLAN_LIMITS.scenarioIdLength && /^[a-z0-9_]+$/.test(id);
}

function intWithin(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validWidth(widthTurn: number): boolean {
  return Number.isFinite(widthTurn) && widthTurn > 0 && widthTurn <= 1;
}

/**
 * Silver below gold, both above 0 and at most the whole tower, and still three medals
 * once the shares round to whole points: a win keeps at least 1 point, so silver asks
 * for 2 or more, and gold for more than silver.
 */
export function turretMedalBarsValid(
  medals: Readonly<TurretMedalBars>,
  integrity: number,
): boolean {
  const gold = medals.gold.minIntegrityShare;
  const silver = medals.silver.minIntegrityShare;
  const shares =
    Number.isFinite(gold) && Number.isFinite(silver) && silver > 0 && silver < gold && gold <= 1;
  if (!shares) return false;
  const silverPoints = turretMedalBarPoints(silver, integrity);
  return silverPoints >= 2 && silverPoints < turretMedalBarPoints(gold, integrity);
}

function resolveArrival(
  arrival: TurretArrivalDef | undefined,
  scenarioId: string,
): TurretArrivalDef {
  if (!arrival) return { kind: 'ring' };
  const valid =
    arrival.kind === 'ring' ||
    (arrival.kind === 'arc' && validWidth(arrival.widthTurn)) ||
    (arrival.kind === 'flanks' &&
      (arrival.count === 2 || arrival.count === 3) &&
      validWidth(arrival.widthTurn)) ||
    (arrival.kind === 'burst' &&
      intWithin(arrival.groupSize, 1, TURRET_PLAN_LIMITS.spawnsPerWave) &&
      intWithin(arrival.groupGapTicks, 0, TURRET_PLAN_LIMITS.groupGapTicks) &&
      validWidth(arrival.widthTurn));
  if (!valid) throw new Error(`turret plan: bad ${arrival.kind} arrival in ${scenarioId}`);
  return { ...arrival };
}

export function resolveTurretPlan(
  scenario: Readonly<TurretScenarioDef> = TURRET_DEFAULT_SCENARIO,
  mobs: Readonly<Record<string, MobTemplate>> = MOBS,
  bowling: Readonly<TurretBowlingDef> = TURRET_BOWLING,
): TurretPlan {
  const limits = TURRET_PLAN_LIMITS;
  if (!turretScenarioIdValid(scenario.id))
    throw new Error(`turret plan: bad scenario id ${JSON.stringify(scenario.id)}`);
  if (!intWithin(scenario.integrity, 1, limits.integrity))
    throw new Error(`turret plan: bad integrity in ${scenario.id}`);
  if (!turretMedalBarsValid(scenario.medals, scenario.integrity))
    throw new Error(`turret plan: bad medal bars in ${scenario.id}`);
  const arsenal: TurretArsenal = {
    shockwave: scenario.arsenal?.shockwave ?? 0,
    fragmentation: scenario.arsenal?.fragmentation ?? 0,
  };
  if (!intWithin(arsenal.shockwave, 0, limits.charges))
    throw new Error(`turret plan: bad shockwave charges in ${scenario.id}`);
  if (!intWithin(arsenal.fragmentation, 0, limits.charges))
    throw new Error(`turret plan: bad fragmentation charges in ${scenario.id}`);
  if (!intWithin(scenario.waves.length, 1, limits.waves))
    throw new Error(`turret plan: bad wave count in ${scenario.id}`);
  const kinds: TurretKind[] = [];
  const kindIndex = new Map<string, number>();
  const kindOf = (entry: TurretWaveEntry): number => {
    const scale = entry.hpScale ?? 1;
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error(`turret plan: bad health scale for ${entry.templateId}`);
    const key = `${entry.templateId}@${entry.level}${scale === 1 ? '' : `x${scale}`}`;
    const known = kindIndex.get(key);
    if (known !== undefined) return known;
    const template = mobs[entry.templateId];
    if (!template) throw new Error(`turret plan: unknown mob template ${entry.templateId}`);
    const sizeClass = TURRET_TEMPLATE_SIZES[entry.templateId];
    if (!sizeClass) throw new Error(`turret plan: no size class for ${entry.templateId}`);
    const size = TURRET_SIZE_CLASSES[sizeClass];
    const baseHp = mobMaxHp(template, entry.level);
    kinds.push({
      templateId: entry.templateId,
      level: entry.level,
      sizeClass,
      maxHp: scale === 1 ? baseHp : Math.max(1, Math.round(baseHp * scale)),
      marchSpeed: template.moveSpeed * TURRET_TIMING.marchFactor,
      mass: size.mass,
      radius: size.radius,
      breachValue: size.breachValue,
      height: size.height,
    });
    kindIndex.set(key, kinds.length - 1);
    return kinds.length - 1;
  };
  const planned = scenario.waves.map((wave) => {
    const entryKinds = wave.entries.map(kindOf);
    const spawns = turretSpawnOrder(wave.entries).map((entry) => entryKinds[entry]);
    if (spawns.length > limits.spawnsPerWave)
      throw new Error(`turret plan: too many spawns in a wave of ${scenario.id}`);
    return {
      spawns,
      coreDamage: wave.coreDamage,
      gapMinTicks: wave.gapMinTicks,
      gapMaxTicks: wave.gapMaxTicks,
      barrels: { ...wave.barrels },
      arrival: resolveArrival(wave.arrival, scenario.id),
    };
  });
  if (kinds.length > limits.kinds)
    throw new Error(`turret plan: too many monster kinds in ${scenario.id}`);
  return deepFreeze({
    scenarioId: scenario.id,
    integrity: scenario.integrity,
    medals: {
      gold: { minIntegrityShare: scenario.medals.gold.minIntegrityShare },
      silver: { minIntegrityShare: scenario.medals.silver.minIntegrityShare },
    },
    arsenal,
    kinds,
    waves: planned,
    bowling: { ...bowling },
  });
}
