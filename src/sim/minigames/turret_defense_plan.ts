// Resolves the Fire and Fly wave table against the real mob templates into a
// plan of plain numbers the engine reads: health from the shared mob formula,
// march speed from the template's own speed, size-class physics per kind, and
// a fixed spawn order per wave.

import {
  TURRET_SIZE_CLASSES,
  TURRET_TEMPLATE_SIZES,
  TURRET_TIMING,
  TURRET_WAVES,
} from '../content/turret_defense';
import { MOBS } from '../data';
import { deepFreeze } from '../deep_freeze';
import { mobMaxHp } from '../entity';
import type { MobTemplate, TurretSizeClass, TurretWaveDef, TurretWaveEntry } from '../types';

export interface TurretKind {
  readonly templateId: string;
  readonly level: number;
  readonly sizeClass: TurretSizeClass;
  readonly maxHp: number;
  readonly marchSpeed: number;
  readonly mass: number;
  readonly radius: number;
  readonly breachValue: number;
}

export interface TurretWavePlan {
  /** Kind indices in spawn order. */
  readonly spawns: readonly number[];
  readonly coreDamage: number;
  readonly gapMinTicks: number;
  readonly gapMaxTicks: number;
}

/** Deep-frozen when resolved: sessions and their views share one plan by reference. */
export interface TurretPlan {
  readonly kinds: readonly TurretKind[];
  readonly waves: readonly TurretWavePlan[];
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

export function resolveTurretPlan(
  waves: readonly TurretWaveDef[] = TURRET_WAVES,
  mobs: Readonly<Record<string, MobTemplate>> = MOBS,
): TurretPlan {
  const kinds: TurretKind[] = [];
  const kindIndex = new Map<string, number>();
  const kindOf = (entry: TurretWaveEntry): number => {
    const key = `${entry.templateId}@${entry.level}`;
    const known = kindIndex.get(key);
    if (known !== undefined) return known;
    const template = mobs[entry.templateId];
    if (!template) throw new Error(`turret plan: unknown mob template ${entry.templateId}`);
    const sizeClass = TURRET_TEMPLATE_SIZES[entry.templateId];
    if (!sizeClass) throw new Error(`turret plan: no size class for ${entry.templateId}`);
    const size = TURRET_SIZE_CLASSES[sizeClass];
    kinds.push({
      templateId: entry.templateId,
      level: entry.level,
      sizeClass,
      maxHp: mobMaxHp(template, entry.level),
      marchSpeed: template.moveSpeed * TURRET_TIMING.marchFactor,
      mass: size.mass,
      radius: size.radius,
      breachValue: size.breachValue,
    });
    kindIndex.set(key, kinds.length - 1);
    return kinds.length - 1;
  };
  const planned = waves.map((wave) => {
    const entryKinds = wave.entries.map(kindOf);
    return {
      spawns: turretSpawnOrder(wave.entries).map((entry) => entryKinds[entry]),
      coreDamage: wave.coreDamage,
      gapMinTicks: wave.gapMinTicks,
      gapMaxTicks: wave.gapMaxTicks,
    };
  });
  return deepFreeze({ kinds, waves: planned });
}
