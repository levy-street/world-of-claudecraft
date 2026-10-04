// Fire and Fly waves as groups, the plan half: each group of a wave resolved from its brick
// into plain numbers the engine and the client both read (turret_wave_groups.ts plays them),
// the wave's spawns laid out group by group, and its keg lots checked. Every rule a forged
// plan could break is a predicate here, shared by the resolver and the online decoder. Pure:
// content in, numbers out, no draw.

import { TURRET_KEG_CROWN, TURRET_TEMPLATE_SIZES } from '../content/turret_defense';
import type {
  MobTemplate,
  TurretGapDef,
  TurretGroupDef,
  TurretKegLotDef,
  TurretSidesDef,
  TurretWaveEntry,
  TurretWaveRole,
} from '../types';
import {
  resolveTurretPack,
  TURRET_HUNT_LIMITS,
  turretRallyBandValid,
  turretRallyKegValid,
} from './turret_hunt_plan';
import { turretKegClusterValid, turretKegLotKegs } from './turret_keg_clusters';

/** Where a walking group comes from: a brick's sides, or bunches each from its own side. */
export type TurretArrivalPlan =
  | TurretSidesDef
  | { kind: 'bunches'; size: number; bunchGapTicks: number; widthTurn: number };

export type TurretBrickPlan =
  | ({ brick: 'walkers'; sides: TurretArrivalPlan } & TurretGapDef)
  | {
      brick: 'pack';
      /** Its index among the wave's packs, in group order: its rally and its side. */
      pack: number;
      /** The advance's pace (yd/s). */
      pace: number;
      /** The spawn index (in the group's order) of its leader. */
      leader: number;
      minRadius: number;
      maxRadius: number;
      holdTicks: number;
      spreadTicks: number;
      widthTurn: number;
    }
  | { brick: 'sprint'; spreadTicks: number; widthTurn: number }
  | ({ brick: 'surgers'; sides: number; widthTurn: number } & TurretGapDef);

export type TurretGroupPlan = TurretBrickPlan & {
  /** Its monsters: the next `count` of the wave's spawns. */
  count: number;
  /** Ticks from the wave's first spawn tick to its own first. */
  delayTicks: number;
};

export interface TurretWavePlan {
  /** Kind indices in spawn order, group by group. */
  readonly spawns: readonly number[];
  readonly coreDamage: number;
  readonly groups: readonly TurretGroupPlan[];
  readonly kegs: readonly TurretKegLotDef[];
  /** Kegs standing at once, this wave's included (absent: TURRET_EXPLOSIVE_BARREL.cap). */
  readonly kegCap?: number;
}

/** The most a wave's groups and lots may carry (the plan's own limits sit in turret_defense_plan.ts). */
export const TURRET_GROUP_LIMITS = {
  groups: 16,
  kegLots: 16,
  delayTicks: 20 * 60,
  surgerSides: 8,
  /** Path lots naming one group. */
  kegsPerGroup: 3,
  /** A group's side draws key from `group * sideKeys`, past the most bunches it can hold. */
  sideKeys: 1024,
} as const;

function intWithin(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function turretWidthValid(widthTurn: number): boolean {
  return Number.isFinite(widthTurn) && widthTurn > 0 && widthTurn <= 1;
}

function gapValid(gap: TurretGapDef, maxTicks: number): boolean {
  return (
    intWithin(gap.gapMinTicks, 0, maxTicks) && intWithin(gap.gapMaxTicks, gap.gapMinTicks, maxTicks)
  );
}

/** A spread group's `j`-th spawn, in ticks from its first (no draw). */
export function turretSpreadTick(spreadTicks: number, count: number, j: number): number {
  return Math.floor((j * spreadTicks) / Math.max(1, count));
}

/** The index in the wave's spawns of group `g`'s first. */
export function turretGroupStart(wave: Pick<TurretWavePlan, 'groups'>, g: number): number {
  let start = 0;
  for (let i = 0; i < g; i++) start += wave.groups[i].count;
  return start;
}

/** How many packs the wave holds: their sides spread evenly around the circle. */
export function turretPackCount(wave: Pick<TurretWavePlan, 'groups'>): number {
  let n = 0;
  for (const group of wave.groups) if (group.brick === 'pack') n++;
  return n;
}

/** The group index of the wave's `pack`-th pack, -1 when it holds none. */
export function turretPackGroup(wave: Pick<TurretWavePlan, 'groups'>, pack: number): number {
  return wave.groups.findIndex((group) => group.brick === 'pack' && group.pack === pack);
}

/** The kind of a pack's leader: only a monster of that kind may cry in its place. */
export function turretPackLeaderKind(wave: TurretWavePlan, g: number): number {
  const group = wave.groups[g];
  if (group?.brick !== 'pack') return -1;
  return wave.spawns[turretGroupStart(wave, g) + group.leader] ?? -1;
}

/** Whether group `g`'s route is known at the wave's start, so a path keg can stand on it. */
function turretGroupHasRoute(wave: Pick<TurretWavePlan, 'groups'>, g: number): boolean {
  const group = wave.groups[g];
  if (!group || group.brick === 'surgers') return false;
  return group.brick !== 'walkers' || group.sides.kind !== 'ring';
}

/** Entry indices in spawn order: interleaved evenly (each entry's i-th at (i + 0.5) / count, ties in entry order), then the boss-last entries. */
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

function sidesValid(sides: TurretSidesDef): boolean {
  if (sides.kind === 'ring') return true;
  if (sides.kind === 'arc') return turretWidthValid(sides.widthTurn);
  return (sides.count === 2 || sides.count === 3) && turretWidthValid(sides.widthTurn);
}

/** Resolves a kind for an entry with the role its group gives it. */
export type TurretKindOf = (entry: TurretWaveEntry, role: TurretWaveRole | undefined) => number;

export interface TurretGroupsResolved {
  readonly spawns: readonly number[];
  readonly groups: readonly TurretGroupPlan[];
}

/**
 * Resolves a wave's groups: each group's spawn order and its brick's plan, the spawns laid
 * out group by group. Throws on content the engine cannot play.
 */
export function resolveTurretGroups(
  defs: readonly TurretGroupDef[],
  kindOf: TurretKindOf,
  mobs: Readonly<Record<string, MobTemplate>>,
  where: string,
  spawnLimit: number,
): TurretGroupsResolved {
  const fail = (what: string): never => {
    throw new Error(`turret plan: ${what} in ${where}`);
  };
  if (!intWithin(defs.length, 1, TURRET_GROUP_LIMITS.groups)) fail('bad group count');
  const window = TURRET_GROUP_LIMITS.delayTicks;
  const spawns: number[] = [];
  const groups: TurretGroupPlan[] = [];
  let packs = 0;
  for (const def of defs) {
    const delayTicks = def.delayTicks ?? 0;
    if (!intWithin(delayTicks, 0, window)) fail('a bad group delay');
    const hunting = def.brick === 'pack';
    for (const entry of def.entries) {
      if (!hunting && (entry.role !== undefined || entry.leads)) fail('a hunt role outside a pack');
      if (hunting && entry.role !== undefined && entry.role !== 'scout') fail('a bad role');
      if ((hunting || def.brick === 'sprint') && entry.bossLast)
        fail('a boss-last entry in a hunt');
    }
    const role: TurretWaveRole | undefined = def.brick === 'sprint' ? 'sprint' : undefined;
    const kinds = def.entries.map((entry) => kindOf(entry, entry.role ?? role));
    const count = def.entries.reduce((n, e) => n + e.count, 0);
    if (!intWithin(count, 1, spawnLimit)) fail('an empty or oversized group');
    const order = turretSpawnOrder(def.entries);
    let brick: TurretBrickPlan;
    switch (def.brick) {
      case 'walkers': {
        const sides = def.sides ?? { kind: 'ring' };
        if (!sidesValid(sides) || !gapValid(def, window)) fail('bad walkers');
        brick = {
          brick: 'walkers',
          sides: { ...sides },
          gapMinTicks: def.gapMinTicks,
          gapMaxTicks: def.gapMaxTicks,
        };
        break;
      }
      case 'smallGroup':
        if (
          !intWithin(def.size, 1, spawnLimit) ||
          !intWithin(def.bunchGapTicks, 0, window) ||
          !turretWidthValid(def.widthTurn) ||
          !gapValid(def, window)
        )
          fail('a bad small group');
        brick = {
          brick: 'walkers',
          sides: {
            kind: 'bunches',
            size: def.size,
            bunchGapTicks: def.bunchGapTicks,
            widthTurn: def.widthTurn,
          },
          gapMinTicks: def.gapMinTicks,
          gapMaxTicks: def.gapMaxTicks,
        };
        break;
      case 'bigOne': {
        const big = def.entries.some((e) => {
          const size = TURRET_TEMPLATE_SIZES[e.templateId];
          return e.count > 0 && (size === 'large' || size === 'huge');
        });
        if (!big) fail('a big one with no large or huge monster');
        if (!turretWidthValid(def.widthTurn) || !gapValid(def, window)) fail('a bad big one');
        brick = {
          brick: 'walkers',
          sides: { kind: 'arc', widthTurn: def.widthTurn },
          gapMinTicks: def.gapMinTicks,
          gapMaxTicks: def.gapMaxTicks,
        };
        break;
      }
      case 'surge':
        if (
          (def.sides !== 1 && def.sides !== 2) ||
          !turretWidthValid(def.widthTurn) ||
          !gapValid(def, window)
        )
          fail('a bad surge');
        brick = {
          brick: 'walkers',
          sides:
            def.sides === 1
              ? { kind: 'arc', widthTurn: def.widthTurn }
              : { kind: 'flanks', count: 2, widthTurn: def.widthTurn },
          gapMinTicks: def.gapMinTicks,
          gapMaxTicks: def.gapMaxTicks,
        };
        break;
      case 'surgers':
        if (
          !intWithin(def.sides, 1, TURRET_GROUP_LIMITS.surgerSides) ||
          count % def.sides !== 0 ||
          !turretWidthValid(def.widthTurn) ||
          !gapValid(def, window)
        )
          fail('bad surgers');
        brick = {
          brick: 'surgers',
          sides: def.sides,
          widthTurn: def.widthTurn,
          gapMinTicks: def.gapMinTicks,
          gapMaxTicks: def.gapMaxTicks,
        };
        break;
      case 'pack': {
        if (packs >= TURRET_HUNT_LIMITS.packs) fail('too many packs');
        const pack = resolveTurretPack(def, order, mobs, where);
        brick = {
          brick: 'pack',
          pack: packs++,
          pace: pack.pace,
          leader: pack.leader,
          minRadius: def.minRadius,
          maxRadius: def.maxRadius,
          holdTicks: def.holdTicks,
          spreadTicks: def.spreadTicks,
          widthTurn: def.widthTurn,
        };
        break;
      }
      case 'sprint':
        if (!intWithin(def.spreadTicks, 0, window) || !turretWidthValid(def.widthTurn))
          fail('a bad sprint group');
        brick = { brick: 'sprint', spreadTicks: def.spreadTicks, widthTurn: def.widthTurn };
        break;
    }
    for (const entry of order) spawns.push(kinds[entry]);
    groups.push({ ...brick, count, delayTicks });
  }
  if (groups.some((g) => g.brick === 'sprint') && packs === 0) fail('a sprint group with no pack');
  return { spawns, groups };
}

/** A front or side path lot's distance band: both ends or neither. */
function routeBandValid(lot: { minRadius?: number; maxRadius?: number }): boolean {
  if (lot.minRadius === undefined && lot.maxRadius === undefined) return true;
  return (
    Number.isFinite(lot.minRadius) &&
    Number.isFinite(lot.maxRadius) &&
    (lot.minRadius as number) >= 0 &&
    (lot.minRadius as number) <= (lot.maxRadius as number)
  );
}

/** A keg lot's own fields, before its group is checked against the wave. */
function lotShapeValid(lot: TurretKegLotDef, barrels: number): boolean {
  switch (lot.mode) {
    case 'random':
      return (
        intWithin(lot.count, 1, barrels) &&
        Number.isFinite(lot.minRadius) &&
        Number.isFinite(lot.maxRadius) &&
        lot.minRadius >= 0 &&
        lot.minRadius <= lot.maxRadius &&
        (lot.lanes === undefined || lot.lanes === true) &&
        (lot.spaced === undefined || lot.spaced === true) &&
        turretKegClusterValid(lot, lot.count)
      );
    case 'crown':
      return (
        intWithin(lot.count, 1, barrels) &&
        Object.hasOwn(TURRET_KEG_CROWN, lot.size) &&
        turretKegClusterValid(lot, lot.count)
      );
    case 'path':
      return (
        Number.isSafeInteger(lot.group) &&
        (lot.spaced === undefined || lot.spaced === true) &&
        turretKegClusterValid({ cluster: lot.cluster }, 1) &&
        (lot.placement === 'front' || lot.placement === 'side'
          ? turretRallyKegValid({ placement: lot.placement }) && routeBandValid(lot)
          : lot.placement === 'axis' &&
            turretRallyKegValid({ placement: 'axis', fromTower: lot.fromTower }))
      );
  }
}

/** The kegs a wave's lots lay at most. */
function turretKegLotsCount(kegs: readonly TurretKegLotDef[]): number {
  let n = 0;
  for (const lot of kegs) n += turretKegLotKegs(lot);
  return n;
}

/**
 * A wave's keg lots against its groups: known modes, at most `barrels` kegs in all, every
 * path lot on a group with a route, at most a few per group.
 */
export function turretKegLotsValid(
  kegs: readonly TurretKegLotDef[],
  wave: Pick<TurretWavePlan, 'groups'>,
  barrels: number,
): boolean {
  if (kegs.length > TURRET_GROUP_LIMITS.kegLots) return false;
  if (!kegs.every((lot) => lotShapeValid(lot, barrels))) return false;
  if (turretKegLotsCount(kegs) > barrels) return false;
  const perGroup = new Map<number, number>();
  for (const lot of kegs) {
    if (lot.mode !== 'path') continue;
    if (!turretGroupHasRoute(wave, lot.group)) return false;
    const banded = lot.placement !== 'axis' && lot.minRadius !== undefined;
    if (banded && wave.groups[lot.group].brick === 'pack') return false;
    perGroup.set(lot.group, (perGroup.get(lot.group) ?? 0) + 1);
  }
  return [...perGroup.values()].every((n) => n <= TURRET_GROUP_LIMITS.kegsPerGroup);
}

function brickPlanValid(group: TurretGroupPlan, kindRoles: readonly (string | undefined)[]) {
  const window = TURRET_GROUP_LIMITS.delayTicks;
  switch (group.brick) {
    case 'walkers': {
      const sides = group.sides;
      const known =
        sides.kind === 'bunches'
          ? intWithin(sides.size, 1, Number.MAX_SAFE_INTEGER) &&
            intWithin(sides.bunchGapTicks, 0, window) &&
            turretWidthValid(sides.widthTurn)
          : sidesValid(sides);
      return known && gapValid(group, window) && kindRoles.every((r) => r === undefined);
    }
    case 'surgers':
      return (
        intWithin(group.sides, 1, TURRET_GROUP_LIMITS.surgerSides) &&
        group.count % group.sides === 0 &&
        turretWidthValid(group.widthTurn) &&
        gapValid(group, window) &&
        kindRoles.every((r) => r === undefined)
      );
    case 'sprint':
      return (
        intWithin(group.spreadTicks, 0, window) &&
        turretWidthValid(group.widthTurn) &&
        kindRoles.every((r) => r === 'sprint')
      );
    case 'pack':
      return (
        Number.isFinite(group.pace) &&
        group.pace > 0 &&
        intWithin(group.leader, 0, group.count - 1) &&
        turretRallyBandValid(group.minRadius, group.maxRadius) &&
        intWithin(group.holdTicks, 0, TURRET_HUNT_LIMITS.windowTicks) &&
        intWithin(group.spreadTicks, 0, TURRET_HUNT_LIMITS.windowTicks) &&
        turretWidthValid(group.widthTurn) &&
        kindRoles.every((r) => r === undefined || r === 'scout')
      );
  }
}

/**
 * A wave plan as the engine can play it: its groups' counts covering its spawns, every
 * spawn's kind known and its role its group's, the packs numbered in group order, a sprint
 * group only beside a pack, and its keg lots on its groups.
 */
export function turretWavePlanValid(
  wave: TurretWavePlan,
  roles: readonly (string | undefined)[],
  barrels: number,
): boolean {
  if (!intWithin(wave.groups.length, 1, TURRET_GROUP_LIMITS.groups)) return false;
  let start = 0;
  let packs = 0;
  for (const group of wave.groups) {
    if (!intWithin(group.count, 1, Number.MAX_SAFE_INTEGER)) return false;
    if (!intWithin(group.delayTicks, 0, TURRET_GROUP_LIMITS.delayTicks)) return false;
    const kinds = wave.spawns.slice(start, start + group.count);
    if (kinds.length !== group.count || kinds.some((k) => !intWithin(k, 0, roles.length - 1)))
      return false;
    if (group.brick === 'pack' && group.pack !== packs++) return false;
    if (
      !brickPlanValid(
        group,
        kinds.map((k) => roles[k]),
      )
    )
      return false;
    start += group.count;
  }
  if (start !== wave.spawns.length || packs > TURRET_HUNT_LIMITS.packs) return false;
  if (packs === 0 && wave.groups.some((g) => g.brick === 'sprint')) return false;
  if (wave.kegCap !== undefined && !intWithin(wave.kegCap, 1, barrels)) return false;
  return turretKegLotsValid(wave.kegs, wave, barrels);
}
