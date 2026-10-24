// Vael's Shadow Crossing (moved out of vael.ts, then made a chain): Death
// sinks into the shadows, a pool opens behind one player, and he rises out of
// it with the scythe through their back; then he sinks again and does it to a
// SECOND player, and a third, each a different one while anyone new stands
// (the non-tanks first, the tank only when nobody else is left, and a group
// smaller than the chain gets a shorter chain: one step per living player).
//
//   step     vanish 0.8 s (untouchable) -> the pool shows behind the mark
//            1.6 s (still untouchable, under the floor) -> he rises 0.6 s
//            (the Reaping Scythe bar, touchable) -> the sweep: 60 to 70
//            shadow to everyone in a 150 degree, 8 yd arc along the pool's
//            facing -> a 0.5 s follow-through (touchable) -> the next step.
//   chain    3 steps; the next 20 s of open fight after the last ends (about
//            33 s a cycle; first at 12 s): VAEL_TUNING has the math.
//   heroic   Grave Shadow: each pool lingers 6 s after its sweep and burns
//            anyone within 3 yd of it for 18 shadow a second.
//
// Zero rng in every pick (pickMarkTargets hashes); the only draws are the
// sweep's damage rolls.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type VaelFightState } from '../../types';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  spawnEncounterObject,
  startBar,
} from './claim';
import {
  BEACON,
  CROWN,
  GRAVE_SHADOW_TEMPLATE,
  inReapingSweep,
  REAPER_POOL_TEMPLATE,
  reaperPoolSpot,
  VAEL_MIST_SURGE,
  VAEL_REAP_MARK,
  VAEL_REAPING_SCYTHE,
  VAEL_SHADOWED,
  VAEL_SHADOWSTEP,
  VAEL_TUNING,
} from './ids';

const T = VAEL_TUNING;
type Reap = NonNullable<VaelFightState['reap']>;

/** Pin Vael where the reap holds him (the mob AI already moved him this tick). */
function pinAt(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  x: number,
  z: number,
  yaw: number,
): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  boss.pos.x = g.x;
  boss.pos.y = g.y;
  boss.pos.z = g.z;
  boss.facing = yaw;
  boss.swingTimer = Math.max(boss.swingTimer, 1);
  ctx.grid.update(boss);
}

/** Keep a pool spot on the crown: inside the rim, clear of the lighthouse. */
function onCrown(x: number, z: number): { x: number; z: number } {
  let dx = x - CROWN.x;
  let dz = z - CROWN.z;
  let d = Math.hypot(dx, dz);
  const outer = CROWN.r - 2.5;
  const inner = BEACON.r + 1.5;
  if (d < 1e-6) {
    dx = 0;
    dz = 1;
    d = 1;
  }
  const r = Math.min(outer, Math.max(inner, d));
  return { x: CROWN.x + (dx / d) * r, z: CROWN.z + (dz / d) * r };
}

/** The next step's mark: someone the chain has not taken yet (hashed, the
 *  non-tanks first), else anyone still standing. */
function nextMark(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
  marked: readonly number[],
  step: number,
): Entity | null {
  const players = claimPlayers(ctx, inst);
  const salt = st.reaps * 7 + step + 211;
  return (
    pickMarkTargets(boss, players, 1, salt, new Set(marked))[0] ??
    pickMarkTargets(boss, players, 1, salt)[0] ??
    null
  );
}

/** He sinks for a step: the Shadowstep bar, untouchable until he rises. */
function sinkFor(ctx: SimContext, boss: Entity, reap: Reap): void {
  reap.phase = 'vanish';
  reap.elapsed = 0;
  reap.poolId = -1;
  startBar(boss, VAEL_SHADOWSTEP, T.vanishSeconds + T.poolSeconds, reap.markId);
  ctx.applyAura(boss, {
    id: VAEL_SHADOWED,
    name: 'Shadow Crossing',
    kind: 'buff_dr',
    remaining: T.vanishSeconds + T.poolSeconds,
    duration: T.vanishSeconds + T.poolSeconds,
    value: 0,
    sourceId: boss.id,
    school: 'shadow',
  });
  boss.damageImmune = true;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
    ability: VAEL_SHADOWSTEP,
  });
}

/** Vael sinks into the shadows: a chain of steps begins (dev + cadence). */
export function startShadowstep(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
): boolean {
  if (st.veil || st.reap || st.gather) return false;
  const players = claimPlayers(ctx, inst);
  const mark = pickMarkTargets(boss, players, 1, st.reaps + 211)[0];
  if (!mark) return false;
  clearCastIf(boss, VAEL_MIST_SURGE);
  st.reaps++;
  st.reapTimer = T.reapEvery;
  const at = localOf(ctx, inst, boss);
  st.reap = {
    phase: 'vanish',
    elapsed: 0,
    markId: mark.id,
    poolId: -1,
    x: at.x,
    z: at.z,
    yaw: boss.facing,
    fromX: at.x,
    fromZ: at.z,
    step: 1,
    steps: Math.max(1, Math.min(T.reapChain, players.length)),
    marked: [mark.id],
  };
  sinkFor(ctx, boss, st.reap);
  return true;
}

/** The pool opens behind the mark (or behind whoever still stands). */
function openPool(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: VaelFightState): boolean {
  const reap = st.reap;
  if (!reap) return false;
  let mark = ctx.entities.get(reap.markId);
  if (!mark || mark.dead || mark.ghost) {
    mark = nextMark(ctx, inst, boss, st, reap.marked, reap.step + 12) ?? undefined;
    if (!mark) return false;
    reap.markId = mark.id;
    if (!reap.marked.includes(mark.id)) reap.marked.push(mark.id);
  }
  const at = localOf(ctx, inst, mark);
  const spot = reaperPoolSpot(at.x, at.z, mark.facing);
  const safe = onCrown(spot.x, spot.z);
  const yaw = Math.atan2(at.x - safe.x, at.z - safe.z);
  reap.x = safe.x;
  reap.z = safe.z;
  reap.yaw = yaw;
  const pool = spawnEncounterObject(
    ctx,
    inst,
    REAPER_POOL_TEMPLATE,
    'Shadow Pool',
    safe.x,
    safe.z,
    yaw,
    1,
  );
  reap.poolId = pool.id;
  ctx.applyAura(mark, {
    id: VAEL_REAP_MARK,
    name: 'Marked by Death',
    // A mark, not a slow: the value leaves the runner at full speed.
    kind: 'slow',
    remaining: T.poolSeconds + T.riseSeconds,
    duration: T.poolSeconds + T.riseSeconds,
    value: 1,
    sourceId: boss.id,
    school: 'shadow',
    undispellable: true,
  });
  // He crosses under the floor: his body waits beneath the pool.
  pinAt(ctx, inst, boss, safe.x, safe.z, yaw);
  boss.prevPos = { ...boss.pos };
  boss.prevFacing = boss.facing;
  boss.castTargetId = mark.id;
  return true;
}

/** The scythe comes round: everyone in the arc is struck. */
function sweep(ctx: SimContext, inst: InstanceSlot, boss: Entity, reap: Reap): void {
  const o = ctx.instanceOriginOf(inst);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: reap.markId,
    school: 'shadow',
    fx: 'flourish',
    ability: VAEL_REAPING_SCYTHE,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (!inReapingSweep(reap.x, reap.z, reap.yaw, p.pos.x - o.x, p.pos.z - o.z)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.sweepMin, T.sweepMax),
      false,
      'shadow',
      'Reaping Scythe',
      'hit',
      true,
    );
  }
}

/** Close one step: the pool dries (or, heroic, burns on) and its mark lifts. */
function closeStep(
  ctx: SimContext,
  inst: InstanceSlot,
  st: VaelFightState,
  keepGrave: boolean,
): void {
  const reap = st.reap;
  if (!reap) return;
  const mark = ctx.entities.get(reap.markId);
  if (mark) dropAuraById(mark, VAEL_REAP_MARK);
  if (reap.poolId < 0) return;
  const pool = ctx.entities.get(reap.poolId);
  const id = reap.poolId;
  reap.poolId = -1;
  if (keepGrave && pool) {
    pool.templateId = GRAVE_SHADOW_TEMPLATE;
    pool.name = 'Grave Shadow';
    st.graves.push({ objectId: pool.id, remaining: T.graveSeconds, tick: 1 });
    return;
  }
  dropEncounterObject(ctx, inst, id);
}

/** End the whole chain: the step closes, he is touchable and free to fight. */
export function endReap(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
  keepGrave = false,
): void {
  if (!st.reap) return;
  closeStep(ctx, inst, st, keepGrave);
  st.reap = null;
  dropAuraById(boss, VAEL_SHADOWED);
  boss.damageImmune = false;
  clearCastIf(boss, VAEL_SHADOWSTEP, VAEL_REAPING_SCYTHE);
}

/** One tick of the chain in flight. */
export function stepReap(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
): void {
  const reap = st.reap;
  if (!reap) return;
  reap.elapsed += DT;
  // The Shadowstep's bar runs down with the step's own clock (the sink and
  // the wait under the pool), as the rise's bar does below: the HUD fills it
  // and the renderer locks the sink to it.
  if ((reap.phase === 'vanish' || reap.phase === 'pool') && boss.castingAbility === VAEL_SHADOWSTEP)
    boss.castRemaining = Math.max(0, T.vanishSeconds + T.poolSeconds - reap.elapsed);
  if (reap.phase === 'vanish') {
    pinAt(ctx, inst, boss, reap.fromX, reap.fromZ, reap.yaw);
    if (reap.elapsed < T.vanishSeconds) return;
    if (!openPool(ctx, inst, boss, st)) {
      endReap(ctx, inst, boss, st);
      return;
    }
    reap.phase = 'pool';
    return;
  }
  pinAt(ctx, inst, boss, reap.x, reap.z, reap.yaw);
  if (reap.phase === 'pool') {
    if (reap.elapsed < T.vanishSeconds + T.poolSeconds) return;
    // He rises: touchable again, the scythe drawn back for the sweep.
    reap.phase = 'rise';
    dropAuraById(boss, VAEL_SHADOWED);
    boss.damageImmune = false;
    startBar(boss, VAEL_REAPING_SCYTHE, T.riseSeconds, reap.markId);
    return;
  }
  const struck = T.vanishSeconds + T.poolSeconds + T.riseSeconds;
  if (reap.phase === 'rise') {
    boss.castRemaining = Math.max(0, struck - reap.elapsed);
    if (reap.elapsed < struck) return;
    sweep(ctx, inst, boss, reap);
    clearCastIf(boss, VAEL_REAPING_SCYTHE);
    closeStep(ctx, inst, st, inst.difficulty === 'heroic');
    reap.phase = 'recover';
    return;
  }
  // The follow-through: he stands where he rose, touchable, then the next step.
  // (A hair of slack: the step clock sums DT, and the next step must not slip
  // a tick behind every step before it.)
  if (reap.elapsed < struck + T.reapRecover - 1e-6) return;
  if (reap.step >= reap.steps) {
    endReap(ctx, inst, boss, st);
    return;
  }
  const mark = nextMark(ctx, inst, boss, st, reap.marked, reap.step);
  if (!mark) {
    endReap(ctx, inst, boss, st);
    return;
  }
  reap.step++;
  reap.markId = mark.id;
  if (!reap.marked.includes(mark.id)) reap.marked.push(mark.id);
  reap.fromX = reap.x;
  reap.fromZ = reap.z;
  sinkFor(ctx, boss, reap);
}

/** Heroic Grave Shadows burn on round their pools, then dry. */
export function stepGraves(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: VaelFightState,
): void {
  if (st.graves.length === 0) return;
  for (const g of [...st.graves]) {
    g.remaining -= DT;
    const pool = ctx.entities.get(g.objectId);
    if (!pool || g.remaining <= 0) {
      dropEncounterObject(ctx, inst, g.objectId);
      st.graves = st.graves.filter((x) => x !== g);
      continue;
    }
    g.tick -= DT;
    if (g.tick > 0) continue;
    g.tick += 1;
    for (const p of claimPlayers(ctx, inst)) {
      if (dist2d(p.pos, pool.pos) > T.graveRadius) continue;
      ctx.dealDamage(
        boss,
        p,
        Math.max(1, Math.round(T.gravePerSecond * (boss.mechanicDamageMult ?? 1))),
        false,
        'shadow',
        'Grave Shadow',
        'hit',
        true,
      );
    }
  }
}

export function clearGraves(ctx: SimContext, inst: InstanceSlot, st: VaelFightState): void {
  for (const g of st.graves) dropEncounterObject(ctx, inst, g.objectId);
  st.graves = [];
}
