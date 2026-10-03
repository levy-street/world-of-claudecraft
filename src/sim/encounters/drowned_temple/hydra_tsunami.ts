// The Mere Hydra's Tsunami (sixth pass): every 40 s (first at 24 s) the whole
// Hydra sinks into its pool and a wave rises on the east rim (then the west,
// alternating). A 4.5 s bar on every head, the wave standing up on its side of
// the rim, then it rolls over THAT half of the pool: 160 to 190 frost and a
// 10 yd shove to everyone it catches. The other half is safe, and so is the
// lee of a broken rim column (the wave breaks on it). Submerged, the heads take
// 75 percent less damage, so nobody is paid to stay.
//
// Heroic backwash: 3.5 s after the wave lands it rolls back over the other
// half, so the half you ran to is the next one to leave.
//
// Zero rng: the side alternates; the only draws are the damage rolls.

import { pullToward } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type HydraFightState } from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  HYDRA_SUBMERGED,
  HYDRA_TSUNAMI,
  HYDRA_TUNING,
  inTsunamiLee,
  inTsunamiPath,
  POOL,
  TSUNAMI_TEMPLATES,
  type TsunamiSide,
  tsunamiHeading,
  tsunamiSide,
} from './ids';

const T = HYDRA_TUNING;

function otherSide(side: TsunamiSide): TsunamiSide {
  return side === 'east' ? 'west' : 'east';
}

/** The wave object on a side's rim: it faces the way it will roll. */
function spawnWave(ctx: SimContext, inst: InstanceSlot, side: TsunamiSide): Entity {
  const x = POOL.x + (side === 'east' ? POOL.r : -POOL.r);
  const obj = spawnTempleObject(ctx, inst, TSUNAMI_TEMPLATES.warn, 'Tsunami', x, POOL.z, POOL.r);
  obj.facing = tsunamiHeading(side);
  obj.prevFacing = obj.facing;
  return obj;
}

/** Sink every living head (a bar each, and the submerged ward). */
function submerge(ctx: SimContext, heads: readonly Entity[], seconds: number): void {
  for (const h of heads) {
    startCast(h, HYDRA_TSUNAMI, seconds, null, true);
    ctx.applyAura(h, {
      id: HYDRA_SUBMERGED,
      name: 'Submerged',
      kind: 'buff_dr',
      remaining: seconds + 0.5,
      duration: seconds + 0.5,
      value: T.submergedReduction,
      sourceId: h.id,
      school: 'frost',
    });
  }
}

/** Raise the next Tsunami (returns false while a head is mid-bar). */
export function startTsunami(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly Entity[],
  st: HydraFightState,
): boolean {
  if (heads.length === 0 || heads.some((h) => h.castingAbility !== null)) return false;
  const side = tsunamiSide(st.tsunamis);
  st.tsunamis++;
  const wave = spawnWave(ctx, inst, side);
  st.tsunami = {
    side,
    remaining: T.tsunamiCast,
    objectId: wave.id,
    backwash: inst.difficulty === 'heroic',
  };
  submerge(ctx, heads, T.tsunamiCast);
  ctx.emit({
    type: 'spellfx',
    sourceId: heads[0].id,
    targetId: wave.id,
    school: 'frost',
    fx: 'windup',
    ability: HYDRA_TSUNAMI,
  });
  return true;
}

function landWave(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  side: TsunamiSide,
  waveId: number,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: waveId,
    school: 'frost',
    fx: 'nova',
    ability: HYDRA_TSUNAMI,
  });
  const o = ctx.instanceOriginOf(inst);
  const heading = tsunamiHeading(side);
  const ax = Math.sin(heading);
  const az = Math.cos(heading);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const x = p.pos.x - o.x;
    const z = p.pos.z - o.z;
    if (!inTsunamiPath(side, x, z) || inTsunamiLee(side, x, z)) continue;
    ctx.dealDamage(
      source,
      p,
      mechanicDamage(ctx, source, T.tsunamiMin, T.tsunamiMax),
      false,
      'frost',
      'Tsunami',
      'hit',
      true,
    );
    if (!p.dead)
      pullToward(ctx, p, p.pos.x + ax * 1000, p.pos.z + az * 1000, T.tsunamiKnockback, 0);
  }
}

/** Advance the Tsunami in flight. Returns true while it owns the Hydra (the
 *  heads are under the water and cast nothing else). */
export function stepTsunami(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly Entity[],
  st: HydraFightState,
): boolean {
  const w = st.tsunami;
  if (!w) return false;
  w.remaining -= DT;
  for (const h of heads) {
    if (h.castingAbility === HYDRA_TSUNAMI) h.castRemaining = Math.max(0, w.remaining);
    h.swingTimer = Math.max(h.swingTimer, 0.6);
  }
  const wave = ctx.entities.get(w.objectId);
  if (wave && w.remaining <= T.tsunamiRoll) wave.templateId = TSUNAMI_TEMPLATES.surge;
  if (w.remaining > 0) return true;
  const source = heads[0] ?? null;
  if (source) landWave(ctx, inst, source, w.side, w.objectId);
  dropEncounterObject(ctx, inst, w.objectId);
  if (w.backwash && heads.length > 0) {
    // Heroic: the wave rolls straight back over the other half.
    const side = otherSide(w.side);
    const back = spawnWave(ctx, inst, side);
    st.tsunami = { side, remaining: T.backwashAfter, objectId: back.id, backwash: false };
    submerge(ctx, heads, T.backwashAfter);
    return true;
  }
  st.tsunami = null;
  for (const h of heads) {
    clearCastOf(h, HYDRA_TSUNAMI);
    h.auras = h.auras.filter((a) => a.id !== HYDRA_SUBMERGED);
  }
  return false;
}

/** The fight ended mid-wave: the water falls back. */
export function clearTsunami(ctx: SimContext, inst: InstanceSlot, st: HydraFightState): void {
  if (st.tsunami) dropEncounterObject(ctx, inst, st.tsunami.objectId);
  st.tsunami = null;
}
