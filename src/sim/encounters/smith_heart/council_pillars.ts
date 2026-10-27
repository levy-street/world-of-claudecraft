// The Hammer Council's pillars (docs/design/raid/smith_heart.md section 7.1):
// the quarry's five carved columns (the claim's own objects, spawned with it
// from content/smith_heart.ts at QUARRY_PILLAR_SPOTS) and the pillars the
// Slabwright raises during the fight, at most COUNCIL_TUNING.pillarCap
// standing at once.
//
//   Integrity    3 whole, 2 cracked, 1 about to fall, carried in the object's
//                template id (councilPillarTemplate), so every client mirrors
//                it with no wire change and the renderer draws it.
//   Cover        each standing pillar is a combat wall (instances/
//                combat_wall_state.ts, a round row): it blocks bodies and the
//                sight line Mountain's Wrath checks, offline and online alike
//                (net/combat_wall_wire.ts mirrors it from the entity).
//   Collapse     at 0 a pillar falls: its wall goes the same tick, a patch of
//                rubble lies where it stood for a few seconds and hurts whoever
//                stands in it, then it is gone.
//   Reset        a wipe stands the five columns whole again and the risen ones
//                go; the council's fall sinks the risen ones and leaves the
//                columns as the fight left them.
//
// Zero rng in every pick (distance and roster order); the only draws are the
// damage rolls of the rise's shove and the rubble, in claim-player order.

import { QUARRY_PILLAR_SPOTS, SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';
import { syncCombatWallCollision } from '../../mob/trash_kit/combat_walls';
import { dropKitObject, spawnKitObject } from '../../mob/trash_kit/kit_objects';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { dropEncounterObject, spawnEncounterObject } from '../sunken_bastion/claim';
import {
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_RUBBLE,
  type CouncilRole,
  councilPillarFull,
  councilPillarOf,
  councilPillarRadius,
  councilPillarTemplate,
  councilSoulOf,
  COUNCIL_TUNING as T,
} from './council_ids';
import type { CouncilFightState } from './council_state';

/** A wall's life is the fight's, never a clock's: the engine counts it down
 *  every tick (combat_walls.ts stepCombatWall), so it is given a lifetime no
 *  claim outlives. */
const PILLAR_WALL_LIFE = 1e9;

/** One standing pillar as the council reads it. */
export interface CouncilPillar {
  e: Entity;
  integrity: number;
  risen: boolean;
  r: number;
  /** Mythic: whose soul it holds (council_soul.ts), else null. A soul
   *  pillar's `integrity` is its pips; nothing but a soul's own rules strikes
   *  them (crackPillar refuses it). */
  soul: CouncilRole | null;
}

/** The claim's standing pillars, in object-roster order. */
export function councilPillars(ctx: SimContext, inst: InstanceSlot): CouncilPillar[] {
  const out: CouncilPillar[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (!e) continue;
    const p = councilPillarOf(e.templateId);
    if (p) {
      out.push({
        e,
        integrity: p.integrity,
        risen: p.risen,
        r: councilPillarRadius(p.risen),
        soul: null,
      });
      continue;
    }
    const soul = councilSoulOf(e.templateId);
    if (soul)
      out.push({
        e,
        integrity: soul.pips,
        risen: soul.risen,
        r: councilPillarRadius(soul.risen),
        soul: soul.role,
      });
  }
  return out;
}

/** How many walls the claim's engine objects hold (the publication's census). */
function wallCount(ctx: SimContext, inst: InstanceSlot): number {
  let n = 0;
  for (const id of inst.objectIds) if (ctx.entities.get(id)?.kitObject?.kind === 'wall') n++;
  return n;
}

/** Publish the claim's walls now (a read later this tick sees the change). */
export function syncPillarWalls(ctx: SimContext, inst: InstanceSlot): void {
  syncCombatWallCollision(ctx, inst, wallCount(ctx, inst));
}

/** The columns the claim spawned with are plain objects: give each the
 *  engine's wall state once, so the trash engine publishes it every tick.
 *  Returns true when any was new (the walls were published here). */
export function ensurePillarWalls(ctx: SimContext, inst: InstanceSlot): boolean {
  let fresh = false;
  for (const p of councilPillars(ctx, inst)) {
    if (p.e.kitObject) continue;
    p.e.kitObject = { kind: 'wall', remaining: PILLAR_WALL_LIFE };
    fresh = true;
  }
  if (fresh) syncPillarWalls(ctx, inst);
  return fresh;
}

function spawnPillar(
  ctx: SimContext,
  inst: InstanceSlot,
  lx: number,
  lz: number,
  facing: number,
  risen: boolean,
): Entity {
  const o = ctx.instanceOriginOf(inst);
  return spawnKitObject(
    ctx,
    inst,
    councilPillarTemplate(councilPillarFull(risen), risen),
    'Pillar',
    o.x + lx,
    o.z + lz,
    1,
    facing,
    { kind: 'wall', remaining: PILLAR_WALL_LIFE },
  );
}

/** Instance-local (x, z) of an entity. */
function local(ctx: SimContext, inst: InstanceSlot, e: Entity): { x: number; z: number } {
  const o = ctx.instanceOriginOf(inst);
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

/** A wipe: the five columns stand whole at their sockets again (a column a
 *  soul took is a plain column again), the risen pillars and every rubble
 *  patch go. */
export function restorePillars(ctx: SimContext, inst: InstanceSlot): void {
  const columns = new Map<number, Entity>();
  for (const p of councilPillars(ctx, inst)) {
    if (p.soul) {
      // The soul's own bar and song go with it.
      p.e.castingAbility = null;
      p.e.castRemaining = 0;
      p.e.castTotal = 0;
      p.e.auras = [];
    }
    if (p.risen) {
      dropKitObject(ctx, inst, p.e.id);
      continue;
    }
    const at = local(ctx, inst, p.e);
    const i = QUARRY_PILLAR_SPOTS.findIndex((s) => Math.hypot(s.x - at.x, s.z - at.z) < 1);
    if (i < 0 || columns.has(i)) {
      dropKitObject(ctx, inst, p.e.id);
      continue;
    }
    columns.set(i, p.e);
  }
  QUARRY_PILLAR_SPOTS.forEach((s, i) => {
    const e = columns.get(i);
    if (e) {
      e.templateId = councilPillarTemplate(councilPillarFull(false), false);
      e.kitObject ??= { kind: 'wall', remaining: PILLAR_WALL_LIFE };
    } else spawnPillar(ctx, inst, s.x, s.z, s.rot, false);
  });
  syncPillarWalls(ctx, inst);
}

/** The council's fall: the risen pillars sink back into the floor (the walk
 *  to the Slab is the quarry's own again); the columns stay as they are. */
export function settlePillars(ctx: SimContext, inst: InstanceSlot): void {
  for (const p of councilPillars(ctx, inst)) {
    if (!p.risen) continue;
    ctx.emit({
      type: 'spellfxAt',
      x: p.e.pos.x,
      z: p.e.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.settle,
      radius: p.r,
    });
    dropKitObject(ctx, inst, p.e.id);
  }
  syncPillarWalls(ctx, inst);
}

/** Drop every rubble patch (a reset or the council's fall). */
export function clearRubble(ctx: SimContext, inst: InstanceSlot, st: CouncilFightState): void {
  for (const r of st.rubble) dropEncounterObject(ctx, inst, r.objectId);
  st.rubble = [];
}

/** A pillar falls: its wall goes this tick and a patch of rubble lies there. */
export function collapsePillar(
  ctx: SimContext,
  inst: InstanceSlot,
  st: CouncilFightState,
  p: CouncilPillar,
): void {
  const at = local(ctx, inst, p.e);
  const r = p.r + T.rubblePad;
  ctx.emit({
    type: 'spellfxAt',
    x: p.e.pos.x,
    z: p.e.pos.z,
    school: 'physical',
    fx: 'burst',
    ability: COUNCIL_CUES.collapse,
    radius: r,
  });
  dropKitObject(ctx, inst, p.e.id);
  syncPillarWalls(ctx, inst);
  const obj = spawnEncounterObject(ctx, inst, COUNCIL_RUBBLE, 'Rubble', at.x, at.z, p.e.facing, r);
  obj.dungeonId = inst.dungeonId;
  st.rubble.push({
    objectId: obj.id,
    x: at.x,
    z: at.z,
    r,
    remaining: T.rubbleSeconds,
    tick: T.rubbleTick,
  });
}

/** A pillar loses one piece of integrity (falls at none). Returns true when
 *  it fell. */
export function crackPillar(
  ctx: SimContext,
  inst: InstanceSlot,
  st: CouncilFightState,
  p: CouncilPillar,
): boolean {
  // A soul pillar takes no normal blow (council_soul.ts strikes its pips).
  if (p.soul) return false;
  const left = p.integrity - 1;
  if (left <= 0) {
    collapsePillar(ctx, inst, st, p);
    return true;
  }
  p.integrity = left;
  p.e.templateId = councilPillarTemplate(left, p.risen);
  ctx.emit({
    type: 'spellfx',
    sourceId: p.e.id,
    targetId: p.e.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CUES.crack,
  });
  return false;
}

/** Is an instance-local spot on the quarry's floor, clear of its rim? */
export function onQuarryFloor(lx: number, lz: number): boolean {
  if (authoredFieldSurfaceAt(SMITH_HEART_FIELD, lx, lz)?.id !== 'hammer_pit') return false;
  // Keep a pillar's foot off the rim's worked edge and the stair's foot.
  const probe = T.columnR + 1;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const s = authoredFieldSurfaceAt(
      SMITH_HEART_FIELD,
      lx + Math.sin(a) * probe,
      lz + Math.cos(a) * probe,
    );
    if (s?.id !== 'hammer_pit') return false;
  }
  return true;
}

/** May a pillar rise at instance-local (x, z)? On the floor, clear of every
 *  standing pillar and every council body. */
export function riseSpotClear(
  pillars: readonly { x: number; z: number }[],
  bodies: readonly { x: number; z: number }[],
  x: number,
  z: number,
): boolean {
  if (!onQuarryFloor(x, z)) return false;
  for (const p of pillars) if (Math.hypot(p.x - x, p.z - z) < T.riseGap) return false;
  for (const b of bodies) if (Math.hypot(b.x - x, b.z - z) < T.riseClearOfBodies) return false;
  return true;
}

/** Offsets a rise looks through, nearest first: the spot itself, then rings
 *  of eight round it. */
const RISE_PROBES: readonly { x: number; z: number }[] = (() => {
  const out = [{ x: 0, z: 0 }];
  for (const d of [1.5, 3, 4.5, 6]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + d * 0.3;
      out.push({ x: Math.sin(a) * d, z: Math.cos(a) * d });
    }
  }
  return out;
})();

/** The nearest spot to (x, z) a pillar may rise on, or null. Pure. */
export function nearestRiseSpot(
  pillars: readonly { x: number; z: number }[],
  bodies: readonly { x: number; z: number }[],
  x: number,
  z: number,
): { x: number; z: number } | null {
  for (const o of RISE_PROBES) {
    if (riseSpotClear(pillars, bodies, x + o.x, z + o.z)) return { x: x + o.x, z: z + o.z };
  }
  return null;
}

/**
 * A pillar bursts out of the floor at instance-local (x, z) (nudged to the
 * nearest clear spot), throwing back whoever stands within the knockback
 * radius. Returns the pillar, or null when no spot is clear or the cap is met.
 */
export function raisePillar(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  bodies: readonly Entity[],
  players: readonly Entity[],
  x: number,
  z: number,
  damageMult: number,
  /** A soul's host (council_soul.ts): never refused by the cap. */
  force = false,
): Entity | null {
  const standing = councilPillars(ctx, inst);
  if (!force && standing.length >= T.pillarCap) return null;
  const pillarSpots = standing.map((p) => local(ctx, inst, p.e));
  const bodySpots = bodies.filter((b) => !b.dead).map((b) => local(ctx, inst, b));
  const spot = nearestRiseSpot(pillarSpots, bodySpots, x, z);
  if (!spot) return null;
  const pillar = spawnPillar(ctx, inst, spot.x, spot.z, 0, true);
  syncPillarWalls(ctx, inst);
  ctx.emit({
    type: 'spellfx',
    sourceId: pillar.id,
    targetId: pillar.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CUES.rise,
  });
  const shove = { ...source, pos: { ...pillar.pos } } as Entity;
  for (const p of players) {
    if (p.dead) continue;
    if (Math.hypot(p.pos.x - pillar.pos.x, p.pos.z - pillar.pos.z) > T.riseKnockRadius + 1e-6)
      continue;
    const amount = Math.max(1, Math.round(ctx.rng.range(T.riseMin, T.riseMax) * damageMult));
    ctx.dealDamage(source, p, amount, false, 'physical', COUNCIL_NAMES.wake, 'hit', true);
    if (!p.dead) ctx.applyKnockback(shove, p, T.riseKnockback);
  }
  return pillar;
}

/**
 * The pillar that stands between `from` and `to` (both world points): of the
 * standing pillars whose footprint the segment crosses, the one nearest
 * `from`. Null when no pillar is in the way. Pure geometry.
 */
export function pillarBetween<P extends { e: { pos: { x: number; z: number } }; r: number }>(
  pillars: readonly P[],
  from: { x: number; z: number },
  to: { x: number; z: number },
): P | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return null;
  let best: P | null = null;
  let bestT = Number.POSITIVE_INFINITY;
  for (const p of pillars) {
    const px = p.e.pos.x - from.x;
    const pz = p.e.pos.z - from.z;
    const t = (px * dx + pz * dz) / len2;
    if (t <= 0 || t >= 1) continue;
    const cx = px - dx * t;
    const cz = pz - dz * t;
    // A breath wider than the footprint: the sight sampler steps the line.
    if (cx * cx + cz * cz > (p.r + 0.35) ** 2) continue;
    if (t < bestT) {
      bestT = t;
      best = p;
    }
  }
  return best;
}

/** The standing pillar nearest a player within `reach` of its face, or null
 *  (ties to the earlier in the roster). */
export function pillarNear(
  pillars: readonly CouncilPillar[],
  at: { x: number; z: number },
  reach: number,
): CouncilPillar | null {
  let best: CouncilPillar | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of pillars) {
    const d = Math.hypot(p.e.pos.x - at.x, p.e.pos.z - at.z) - p.r;
    if (d > reach || d >= bestD) continue;
    bestD = d;
    best = p;
  }
  return best;
}

/** One tick of the rubble: it bites whoever stands in it once a second, and
 *  is gone when its time is up. */
export function stepRubble(
  ctx: SimContext,
  inst: InstanceSlot,
  st: CouncilFightState,
  source: Entity,
  players: readonly Entity[],
  damageMult: number,
): void {
  if (st.rubble.length === 0) return;
  const o = ctx.instanceOriginOf(inst);
  for (const r of st.rubble) {
    r.remaining -= DT;
    r.tick -= DT;
    if (r.tick > 1e-9) continue;
    r.tick += T.rubbleTick;
    for (const p of players) {
      if (p.dead || Math.hypot(p.pos.x - o.x - r.x, p.pos.z - o.z - r.z) > r.r) continue;
      const amount = Math.max(1, Math.round(ctx.rng.range(T.rubbleMin, T.rubbleMax) * damageMult));
      ctx.dealDamage(source, p, amount, false, 'physical', COUNCIL_NAMES.rubble, 'hit', true);
    }
  }
  const gone = st.rubble.filter((r) => r.remaining <= 1e-9);
  if (gone.length === 0) return;
  for (const r of gone) dropEncounterObject(ctx, inst, r.objectId);
  st.rubble = st.rubble.filter((r) => r.remaining > 1e-9);
}

/** Heroic: every standing pillar hums, hurting whoever stands close. */
export function pulsePillars(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  players: readonly Entity[],
  damageMult: number,
): number {
  let hits = 0;
  for (const p of councilPillars(ctx, inst)) {
    // A soul pillar keeps to its soul's behaviour (council_soul.ts).
    if (p.soul) continue;
    ctx.emit({
      type: 'spellfx',
      sourceId: p.e.id,
      targetId: p.e.id,
      school: 'nature',
      fx: 'nova',
      ability: COUNCIL_CUES.pulse,
    });
    for (const pl of players) {
      if (pl.dead) continue;
      const d = Math.hypot(pl.pos.x - p.e.pos.x, pl.pos.z - p.e.pos.z) - p.r;
      if (d > T.pulseReach) continue;
      const amount = Math.max(1, Math.round(ctx.rng.range(T.pulseMin, T.pulseMax) * damageMult));
      ctx.dealDamage(source, pl, amount, false, 'nature', COUNCIL_NAMES.pulse, 'hit', true);
      hits++;
    }
  }
  return hits;
}
