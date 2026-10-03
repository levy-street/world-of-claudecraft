// Fire and Fly hunts, the plan half: a pack group resolved into the numbers the engine and
// the client both read (minigames/turret_rally.ts plays them). A pack's members spawn spread
// over its window in its entries' interleaved order, with no draw; it advances at one pace,
// a scale of its slowest gathering member's template; its leader is its leading entry's
// first monster, else its first. Pure: content and templates in, numbers out.

import { TURRET_ARENA, TURRET_TIMING } from '../content/turret_defense';
import type { MobTemplate, TurretGroupDef } from '../types';

/** The most a hunt may carry; a rally's id strides the waves by the pack limit. */
export const TURRET_HUNT_LIMITS = { packs: 8, windowTicks: 20 * 60 } as const;

const KEG_PLACEMENTS: ReadonlySet<string> = new Set(['front', 'side', 'axis']);

/** A path keg's placement as content or a forged plan may state it: an axis keg inside the field. */
export function turretRallyKegValid(
  keg: { placement: 'front' | 'side' } | { placement: 'axis'; fromTower: number },
): boolean {
  if (!KEG_PLACEMENTS.has(keg.placement)) return false;
  if (keg.placement !== 'axis') return true;
  return (
    Number.isFinite(keg.fromTower) &&
    keg.fromTower > TURRET_ARENA.breachRadius &&
    keg.fromTower < TURRET_ARENA.spawnRadius
  );
}

/** A rally band inside the field, nearer than the spawn ring and clear of the tower's foot. */
export function turretRallyBandValid(minRadius: number, maxRadius: number): boolean {
  return (
    Number.isFinite(minRadius) &&
    Number.isFinite(maxRadius) &&
    minRadius > TURRET_ARENA.breachRadius &&
    minRadius <= maxRadius &&
    maxRadius < TURRET_ARENA.spawnRadius
  );
}

function intWithin(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export interface TurretPackResolved {
  /** The advance's pace (yd/s). */
  readonly pace: number;
  /** The spawn index (in `order`) of its leader. */
  readonly leader: number;
}

/**
 * Resolves a pack group whose entries spawn in `order` (entry indices). Throws on content
 * the engine cannot play.
 */
export function resolveTurretPack(
  def: Extract<TurretGroupDef, { brick: 'pack' }>,
  order: readonly number[],
  mobs: Readonly<Record<string, MobTemplate>>,
  where: string,
): TurretPackResolved {
  const fail = (what: string): never => {
    throw new Error(`turret plan: ${what} in a pack of ${where}`);
  };
  const window = TURRET_HUNT_LIMITS.windowTicks;
  if (!turretRallyBandValid(def.minRadius, def.maxRadius)) fail('bad rally band');
  if (!intWithin(def.holdTicks, 0, window)) fail('bad hold');
  if (!intWithin(def.spreadTicks, 0, window)) fail('bad spread');
  if (!(Number.isFinite(def.widthTurn) && def.widthTurn > 0 && def.widthTurn <= 1))
    fail('bad width');
  if (!(Number.isFinite(def.advanceScale) && def.advanceScale > 0)) fail('bad advance scale');
  const entries = def.entries;
  if (!entries.some((e) => e.count > 0)) fail('an empty pack');
  if (entries.filter((e) => e.leads).length > 1) fail('two leading entries');
  const gathering = entries.filter((e) => e.role !== 'scout' && e.count > 0);
  const pacers = gathering.length ? gathering : entries;
  let slowest = Number.POSITIVE_INFINITY;
  for (const e of pacers) {
    const template = mobs[e.templateId];
    if (!template) fail(`unknown mob template ${e.templateId}`);
    slowest = Math.min(slowest, template.moveSpeed * TURRET_TIMING.marchFactor);
  }
  const leadEntry = entries.findIndex((e) => e.leads && e.count > 0);
  const led = order.indexOf(leadEntry);
  return { pace: slowest * def.advanceScale, leader: led >= 0 ? led : 0 };
}
