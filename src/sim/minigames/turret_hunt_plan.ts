// Fire and Fly hunts, the plan half: a hunt wave's packs resolved into plain numbers the
// engine and the client both read (minigames/turret_rally.ts plays them). Each spawn of the
// wave gets its pack (or the sprint group) and its tick from the wave's start, with no
// draw: a pack's members spawn spread over the wave's window from the pack's delay, in its
// entries' interleaved order. A pack advances at one pace, a scale of its slowest
// gathering member's template; its leader is its leading entry's first monster, else its
// first. Pure: content and templates in, numbers out.

import { TURRET_ARENA, TURRET_TIMING } from '../content/turret_defense';
import type { MobTemplate, TurretHuntDef, TurretRallyKegDef, TurretWaveEntry } from '../types';

export interface TurretHuntPackPlan {
  /** The advance's pace (yd/s). */
  readonly pace: number;
  readonly kegs: readonly TurretRallyKegDef[];
  /** Spawn indices (in the wave's order) of its leader and of its last member. */
  readonly leader: number;
  readonly last: number;
}

export interface TurretHuntPlan {
  readonly packs: readonly TurretHuntPackPlan[];
  /** Per spawn in the wave's order: its pack, -1 in the sprint group. */
  readonly groups: readonly number[];
  /** Per spawn: ticks from the wave's start, ascending. */
  readonly ticks: readonly number[];
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly holdTicks: number;
  readonly widthTurn: number;
}

/** The most a hunt may carry; a rally's id strides the waves by the pack limit. */
export const TURRET_HUNT_LIMITS = { packs: 8, kegsPerPack: 3, windowTicks: 20 * 60 } as const;

const KEG_PLACEMENTS: ReadonlySet<string> = new Set(['rally-front', 'rally-side', 'axis']);

function intWithin(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** A rally keg as content or a forged plan may state it: a known placement, an axis keg inside the field. */
export function turretRallyKegValid(keg: Readonly<TurretRallyKegDef>): boolean {
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

/**
 * A hunt plan against its wave's spawns and kinds: one pack or the sprint group per spawn
 * (a sprint kind exactly where the group is -1), ticks ascending, every pack holding a
 * member, its leader one of them and `last` its last.
 */
export function turretHuntPlanValid(
  hunt: TurretHuntPlan,
  spawns: readonly number[],
  roles: readonly (string | undefined)[],
): boolean {
  const n = spawns.length;
  if (hunt.groups.length !== n || hunt.ticks.length !== n) return false;
  if (!turretRallyBandValid(hunt.minRadius, hunt.maxRadius)) return false;
  const lastOf: number[] = hunt.packs.map(() => -1);
  for (let i = 0; i < n; i++) {
    const group = hunt.groups[i];
    if (!intWithin(group, -1, hunt.packs.length - 1)) return false;
    if ((group === -1) !== (roles[spawns[i]] === 'sprint')) return false;
    if (i > 0 && hunt.ticks[i] < hunt.ticks[i - 1]) return false;
    if (group >= 0) lastOf[group] = i;
  }
  return hunt.packs.every(
    (pack, p) =>
      Number.isFinite(pack.pace) &&
      pack.pace > 0 &&
      pack.last === lastOf[p] &&
      pack.last >= 0 &&
      intWithin(pack.leader, 0, pack.last) &&
      hunt.groups[pack.leader] === p &&
      pack.kegs.length <= TURRET_HUNT_LIMITS.kegsPerPack &&
      pack.kegs.every(turretRallyKegValid),
  );
}

interface Slot {
  at: number;
  group: number;
  order: number;
  entry: number;
}

/** Entry indices interleaved evenly across a group, ties in entry order (turretSpawnOrder's rule). */
function interleave(entries: readonly number[], counts: readonly number[]): number[] {
  const slots: { at: number; entry: number; rank: number }[] = [];
  entries.forEach((entry, rank) => {
    for (let i = 0; i < counts[entry]; i++)
      slots.push({ at: (i + 0.5) / counts[entry], entry, rank });
  });
  slots.sort((a, b) => a.at - b.at || a.rank - b.rank);
  return slots.map((s) => s.entry);
}

export interface TurretHuntResolved {
  /** Entry indices in spawn order. */
  readonly order: readonly number[];
  readonly hunt: TurretHuntPlan;
}

/**
 * Resolves a hunt wave: the spawn order (by tick, packs in order, the sprint group last on
 * a tie) and the hunt plan. Throws on content the engine cannot play.
 */
export function resolveTurretHunt(
  def: Readonly<TurretHuntDef>,
  entries: readonly TurretWaveEntry[],
  mobs: Readonly<Record<string, MobTemplate>>,
  where: string,
): TurretHuntResolved {
  const fail = (what: string): never => {
    throw new Error(`turret plan: ${what} in a hunt of ${where}`);
  };
  const packs = def.packs.length;
  if (!intWithin(packs, 1, TURRET_HUNT_LIMITS.packs)) fail('bad pack count');
  if (!turretRallyBandValid(def.minRadius, def.maxRadius)) fail('bad rally band');
  const window = TURRET_HUNT_LIMITS.windowTicks;
  if (!intWithin(def.holdTicks, 0, window)) fail('bad hold');
  if (!intWithin(def.spreadTicks, 0, window)) fail('bad spread');
  if (!(Number.isFinite(def.widthTurn) && def.widthTurn > 0 && def.widthTurn <= 1))
    fail('bad width');
  const members: number[][] = def.packs.map(() => []);
  const sprint: number[] = [];
  entries.forEach((entry, i) => {
    if (entry.role === 'sprint') {
      if (entry.pack !== undefined || entry.leads) fail('a sprint entry in a pack');
      sprint.push(i);
    } else if (entry.pack === undefined || !intWithin(entry.pack, 0, packs - 1)) {
      fail('an entry with no pack');
    } else members[entry.pack].push(i);
  });
  if (sprint.length && !intWithin(def.sprintDelayTicks ?? -1, 0, window))
    fail('a sprint group with no delay');
  const counts = entries.map((e) => e.count);
  const slots: Slot[] = [];
  const place = (group: number, list: readonly number[], delay: number) => {
    const order = interleave(list, counts);
    order.forEach((entry, j) => {
      const at = delay + Math.floor((j * def.spreadTicks) / Math.max(1, order.length));
      slots.push({ at, group, order: j, entry });
    });
  };
  def.packs.forEach((pack, p) => {
    if (!members[p].some((e) => counts[e] > 0)) fail('an empty pack');
    if (!intWithin(pack.delayTicks, 0, window)) fail('bad pack delay');
    if (!(Number.isFinite(pack.advanceScale) && pack.advanceScale > 0)) fail('bad advance scale');
    if (members[p].filter((e) => entries[e].leads).length > 1) fail('two leading entries');
    if (pack.kegs.length > TURRET_HUNT_LIMITS.kegsPerPack || !pack.kegs.every(turretRallyKegValid))
      fail('bad rally kegs');
    place(p, members[p], pack.delayTicks);
  });
  place(packs, sprint, def.sprintDelayTicks ?? 0);
  slots.sort((a, b) => a.at - b.at || a.group - b.group || a.order - b.order);
  const groups = slots.map((s) => (s.group === packs ? -1 : s.group));
  const planned = def.packs.map((pack, p) => {
    const gathering = members[p].filter((e) => entries[e].role !== 'scout' && counts[e] > 0);
    const pacers = gathering.length ? gathering : members[p];
    let slowest = Number.POSITIVE_INFINITY;
    for (const e of pacers) {
      const template = mobs[entries[e].templateId];
      if (!template) fail(`unknown mob template ${entries[e].templateId}`);
      slowest = Math.min(slowest, template.moveSpeed * TURRET_TIMING.marchFactor);
    }
    const leadEntry = members[p].find((e) => entries[e].leads && counts[e] > 0);
    const first = slots.findIndex((s) => s.group === p);
    const led = slots.findIndex((s) => s.group === p && s.entry === leadEntry);
    return {
      pace: slowest * pack.advanceScale,
      kegs: pack.kegs.map((keg) => ({ ...keg })),
      leader: led >= 0 ? led : first,
      last: groups.lastIndexOf(p),
    };
  });
  return {
    order: slots.map((s) => s.entry),
    hunt: {
      packs: planned,
      groups,
      ticks: slots.map((s) => s.at),
      minRadius: def.minRadius,
      maxRadius: def.maxRadius,
      holdTicks: def.holdTicks,
      widthTurn: def.widthTurn,
    },
  };
}
