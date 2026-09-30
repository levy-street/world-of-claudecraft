// Fire and Fly explosive barrels, the half the engine (turret_defense.ts) drives:
// a wave's barrels placed on a ring around the turret, the spawn bearings that
// keep every marcher's lane clear of them, the barrels as round colliders a
// thrown body bounces off, what lights one (a blast reaching it, a fast body
// touching it), the fuse that blows it and the blast it makes. The blast itself
// is the engine's, on the shell's falloff and launch rules. Pure: private
// stateless draws only, no clock.

import { TURRET_EXPLOSIVE_BARREL, TURRET_PHYSICS, TURRET_WEAPON } from '../content/turret_defense';
import type { TurretBarrelWaveDef } from '../types';
import {
  groundOr,
  horizontalAt,
  planFlight,
  planSkid,
  positionAt,
  type SweepResult,
  sweepCylinder,
  type ThrowProbe,
  velocityAt,
} from './thrown_body';
import type { TurretBlast, TurretDefenseState, TurretEvent } from './turret_defense';
import { TURRET_STREAM, turretDraw } from './turret_defense_rng';

export interface TurretBarrel {
  id: number;
  x: number;
  /** The ground under it, read when it was placed. */
  y: number;
  z: number;
  /** The tick it was lit, -1 while it stands unlit. */
  litTick: number;
  /** The tick it blows, -1 while it stands unlit. */
  blowTick: number;
}

/** A bearing blocked either side of `center` by `half` (rad), x += sin, z += cos. */
export interface TurretBearingArc {
  center: number;
  half: number;
}

const TAU = Math.PI * 2;
/** A contact this much past a barrel's collider (yd) still touches it: a planned contact lands near the rim, not on it. */
const TOUCH_SLACK = 0.25;

function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

/** The bearings from `from` to `from + width` (rad, width up to a full turn). */
export interface TurretBearingSector {
  from: number;
  width: number;
}

/**
 * Maps `u` in [0, 1) uniformly onto the bearings of the sector no arc blocks,
 * walking its free gaps from `from`; null when an arc covers everything or the
 * arcs leave nothing free. A whole turn from 0 skips the clip, so the ring's
 * bearings (the Standard run's digests) replay to the bit.
 */
function freeBearingWithin(
  u: number,
  arcs: readonly TurretBearingArc[],
  from: number,
  width: number,
): number | null {
  const spans: [number, number][] = [];
  for (const arc of arcs) {
    if (!(arc.half > 0)) continue;
    if (arc.half >= Math.PI) return null;
    const start = mod(arc.center - arc.half - from, TAU);
    const end = start + 2 * arc.half;
    if (end > TAU) spans.push([start, TAU], [0, end - TAU]);
    else spans.push([start, end]);
  }
  const inside = width < TAU ? spans.filter((span) => span[0] < width) : spans;
  if (!inside.length) return from + u * width;
  if (width < TAU) for (const span of inside) span[1] = Math.min(span[1], width);
  inside.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of inside) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  let blocked = 0;
  for (const [start, end] of merged) blocked += end - start;
  const free = width - blocked;
  if (!(free > 1e-9)) return null;
  let left = u * free;
  let cursor = 0;
  for (const [start, end] of merged) {
    const gap = start - cursor;
    if (left < gap) return from + (cursor + left);
    left -= gap;
    cursor = end;
  }
  return from + (cursor + left);
}

/**
 * Maps `u` in [0, 1) uniformly onto the bearings no arc blocks, walking the
 * free gaps from bearing 0: with no arc it is `u * 2 PI` exactly. When the arcs
 * leave nothing free, `u * 2 PI` all the same. With a sector, onto the sector's
 * free bearings; a sector the arcs close falls back to the whole circle's.
 */
export function turretFreeBearing(
  u: number,
  arcs: readonly TurretBearingArc[],
  sector?: TurretBearingSector | null,
): number {
  const within = sector ? freeBearingWithin(u, arcs, sector.from, sector.width) : null;
  return within ?? freeBearingWithin(u, arcs, 0, TAU) ?? u * TAU;
}

/**
 * A spawn bearing for a body of `bodyRadius` from the uniform draw `u`, inside
 * the arrival sector when there is one: never one whose straight march to the
 * turret would brush a standing barrel (its lane keeps the two radii plus a
 * margin clear of the barrel's centre).
 */
export function turretSpawnBearing(
  state: TurretDefenseState,
  u: number,
  bodyRadius: number,
  sector?: TurretBearingSector | null,
): number {
  if (!state.barrels.length) return sector ? sector.from + u * sector.width : u * TAU;
  const reach = TURRET_EXPLOSIVE_BARREL.radius + bodyRadius + TURRET_EXPLOSIVE_BARREL.laneMargin;
  // A barrel inside the reach sits across every lane alike: no bearing avoids
  // it, so it blocks none and the others are still steered around.
  const arcs = state.barrels.map((b) => {
    const dx = b.x - state.cx;
    const dz = b.z - state.cz;
    const d = Math.hypot(dx, dz);
    return { center: Math.atan2(dx, dz), half: d > reach ? Math.asin(reach / d) : 0 };
  });
  return turretFreeBearing(u, arcs, sector);
}

/** Dry, free of every barrel by the spacing, and of every body still on the field. */
function clearSpot(
  state: TurretDefenseState,
  x: number,
  z: number,
  tick: number,
  probe: ThrowProbe,
): boolean {
  // A mapped water level can lie under dry ground: only a surface above it is water.
  const water = probe.water(x, z);
  if (water !== null && water > groundOr(probe, x, z, Number.NEGATIVE_INFINITY)) return false;
  for (const b of state.barrels) {
    if (Math.hypot(b.x - x, b.z - z) < TURRET_EXPLOSIVE_BARREL.minSpacing) return false;
  }
  for (const m of state.monsters) {
    if (m.state === 'gone') continue;
    const p = positionAt(m.seg, tick, probe);
    const room =
      TURRET_EXPLOSIVE_BARREL.radius +
      state.plan.kinds[m.kind].radius +
      TURRET_EXPLOSIVE_BARREL.laneMargin;
    if (Math.hypot(p.x - x, p.z - z) < room) return false;
  }
  return true;
}

/**
 * Adds a wave's barrels: bearings spread evenly around the circle from a drawn
 * offset, each wandering inside its share, at a drawn distance in the ring. A
 * barrel that finds no clear spot in its draws is left out, and the barrels
 * standing never pass the cap. Returns the ones placed.
 */
export function placeTurretBarrels(
  state: TurretDefenseState,
  def: Readonly<TurretBarrelWaveDef>,
  tick: number,
  probe: ThrowProbe,
): TurretBarrel[] {
  const placed: TurretBarrel[] = [];
  const count = Math.min(def.count, TURRET_EXPLOSIVE_BARREL.cap - state.barrels.length);
  if (!(count > 0)) return placed;
  const { wave } = state;
  const tries = TURRET_EXPLOSIVE_BARREL.placementTries;
  const offset = turretDraw(state, TURRET_STREAM.barrelBearing, wave, 0) * TAU;
  const sector = TAU / count;
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const key = 1 + i * tries + attempt;
      const wander = attempt === 0 ? TURRET_EXPLOSIVE_BARREL.bearingJitter : 0.5;
      const spread = turretDraw(state, TURRET_STREAM.barrelBearing, wave, key) * 2 - 1;
      const bearing = offset + (i + 0.5 + spread * wander) * sector;
      const r =
        def.minRadius +
        turretDraw(state, TURRET_STREAM.barrelRadius, wave, key) * (def.maxRadius - def.minRadius);
      const x = state.cx + Math.sin(bearing) * r;
      const z = state.cz + Math.cos(bearing) * r;
      if (!clearSpot(state, x, z, tick, probe)) continue;
      const barrel = {
        id: state.nextBarrelId++,
        x,
        y: groundOr(probe, x, z, 0),
        z,
        litTick: -1,
        blowTick: -1,
      };
      state.barrels.push(barrel);
      placed.push(barrel);
      break;
    }
  }
  return placed;
}

/**
 * The standing barrels as round colliders for a swept move of a body of
 * `radius` (thrown_body.ts ThrowProbe.sweep): the nearest one the move enters
 * with the body's feet under its top, or null when it enters none.
 */
export function sweepTurretBarrels(
  barrels: readonly TurretBarrel[],
  fx: number,
  fz: number,
  tx: number,
  tz: number,
  radius: number,
  fromY: number,
  toY: number,
): SweepResult | null {
  let best: SweepResult | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  const reach = TURRET_EXPLOSIVE_BARREL.radius + radius;
  const travel = Math.hypot(tx - fx, tz - fz);
  for (const b of barrels) {
    const d = Math.hypot(b.x - fx, b.z - fz);
    if (d - travel > reach || !(d < bestD)) continue;
    const hit = sweepCylinder(
      b.x,
      b.z,
      reach,
      b.y + TURRET_EXPLOSIVE_BARREL.height,
      fx,
      fz,
      tx,
      tz,
      fromY,
      toY,
    );
    if (!hit.blocked) continue;
    best = hit;
    bestD = d;
  }
  return best;
}

/** The barrel a body of `radius` centred at (x, z) touches, the nearest; null when none. */
export function turretBarrelTouched(
  barrels: readonly TurretBarrel[],
  x: number,
  z: number,
  radius: number,
): TurretBarrel | null {
  let best: TurretBarrel | null = null;
  let bestD = TURRET_EXPLOSIVE_BARREL.radius + radius + TOUCH_SLACK;
  for (const b of barrels) {
    const d = Math.hypot(b.x - x, b.z - z);
    if (d <= bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** Lights an unlit barrel: it blows after the fuse. A lit one keeps its first fuse. */
export function lightTurretBarrel(
  state: TurretDefenseState,
  barrel: TurretBarrel,
  tick: number,
  events: TurretEvent[],
): void {
  if (barrel.litTick >= 0) return;
  const fuseTicks = Math.max(1, TURRET_EXPLOSIVE_BARREL.fuseTicks);
  barrel.litTick = tick;
  barrel.blowTick = tick + fuseTicks;
  state.rev++;
  events.push({
    type: 'barrelLit',
    id: barrel.id,
    x: barrel.x,
    y: barrel.y,
    z: barrel.z,
    fuseTicks,
  });
}

/** Every barrel a blast of `radius` at (x, z) reaches, at any falloff: its centre within the radius plus its own. */
export function lightTurretBarrelsInBlast(
  state: TurretDefenseState,
  x: number,
  z: number,
  radius: number,
  tick: number,
  events: TurretEvent[],
): void {
  for (const b of state.barrels) {
    if (Math.hypot(b.x - x, b.z - z) <= radius + TURRET_EXPLOSIVE_BARREL.radius) {
      lightTurretBarrel(state, b, tick, events);
    }
  }
}

/** A thrown body of `radius` met something at (x, z) at `speed` across: a barrel there lights when it came fast enough. */
export function lightTurretBarrelByBody(
  state: TurretDefenseState,
  x: number,
  z: number,
  radius: number,
  speed: number,
  tick: number,
  events: TurretEvent[],
): void {
  if (!(speed > state.plan.bowling.minSpeed)) return;
  const barrel = turretBarrelTouched(state.barrels, x, z, radius);
  if (barrel) lightTurretBarrel(state, barrel, tick, events);
}

/** Takes the barrels whose fuse has run out by `tick` off the field, earliest fuse first. */
export function takeDueTurretBarrels(state: TurretDefenseState, tick: number): TurretBarrel[] {
  const due = (b: TurretBarrel): boolean => b.blowTick >= 0 && b.blowTick <= tick;
  if (!state.barrels.some(due)) return [];
  const blown = state.barrels.filter(due);
  state.barrels = state.barrels.filter((b) => !due(b));
  return blown.sort((a, b) => a.blowTick - b.blowTick || a.id - b.id);
}

/** A barrel's blast: the shell's rules, wider, harder and stronger, on the current wave's core damage. */
export function turretBarrelBlast(state: TurretDefenseState, barrel: TurretBarrel): TurretBlast {
  const waves = state.plan.waves;
  const wave = waves[Math.min(state.wave, waves.length - 1)];
  return {
    x: barrel.x,
    z: barrel.z,
    radius: TURRET_EXPLOSIVE_BARREL.blastRadius,
    core: TURRET_EXPLOSIVE_BARREL.blastCore,
    damage: (wave ? wave.coreDamage : 0) * TURRET_EXPLOSIVE_BARREL.damageScale,
    push: TURRET_WEAPON.push * TURRET_EXPLOSIVE_BARREL.throwScale,
    pop: TURRET_WEAPON.pop * TURRET_EXPLOSIVE_BARREL.throwScale,
    stream: TURRET_STREAM.barrelThrow,
    key: barrel.id,
  };
}

/**
 * A body whose flight or slide was planned to end against `barrel`, now blown
 * away, would bounce off thin air: it flies or slides on from where it is at
 * `tick`, replanned through the field as it stands. A slide too slow to go on
 * stops where it is.
 */
export function replanPastTurretBarrel(
  state: TurretDefenseState,
  barrel: TurretBarrel,
  tick: number,
  probe: ThrowProbe,
): void {
  for (const m of state.monsters) {
    const seg = m.seg;
    if (seg.kind !== 'fly' && seg.kind !== 'skid') continue;
    // A flight launched this very tick (a shell resolves before the fuses) was
    // planned while the barrel still stood: replanning from its start is the
    // same launch without it.
    if (seg.contact !== 'wall' || !(seg.start <= tick) || !(seg.end > tick)) continue;
    const kind = state.plan.kinds[m.kind];
    const end = horizontalAt(seg, seg.end);
    const reach = TURRET_EXPLOSIVE_BARREL.radius + kind.radius + TOUCH_SLACK;
    if (Math.hypot(end.x - barrel.x, end.z - barrel.z) > reach) continue;
    const p = positionAt(seg, tick, probe);
    const v = velocityAt(seg, tick);
    if (seg.kind === 'fly') {
      m.seg = planFlight(tick, p.x, p.y, p.z, v, kind.radius, probe, TURRET_PHYSICS);
    } else {
      m.seg = planSkid(tick, p.x, p.y, p.z, v.x, v.z, kind.radius, probe, TURRET_PHYSICS) ?? {
        ...seg,
        end: tick,
        contact: 'stop',
      };
    }
    state.rev++;
  }
}
