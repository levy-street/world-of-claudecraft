// The Knellwyrm's heroic Burning Knell (docs/design/dungeon-rework/
// hollow_crypt.md 5.4, the owner's heroic addition): its normal kit is
// untouched (knellwyrm.ts); on heroic, every so often it TAKES FLIGHT over the
// Rite Ring and tolls a burning knell.
//
//   rise    2.5 s  it takes wing from where it stands and climbs to hang over
//                  the ring's centre, out of reach (nobody's target, immune).
//   mark    4.5 s  HALF of the ring is marked in red (an encounter object the
//                  clients draw: `facing` the half's direction, `scale` its
//                  reach): get to the other half.
//   breath  1.4 s  its ghost fire lands on the marked half as the pour begins:
//                  everyone in it burns (the heroic wipe check: about 80 to 90
//                  percent of heroic cloth). The flames play out.
//   ...            three halves a flight, each a different quarter of the
//                  compass from the last (so the safe half moves).
//   land    2.5 s  it glides back down where it took wing and fights on.
//
// Its other mechanics' clocks wait while it flies (it neither strafes nor
// bellows from the sky). Deterministic: the halves are drawn from ctx.rng in a
// fixed order (one int at each mark: the first of four quarters, then one of
// the three others), the damage rolls after it in claim-player order; the
// flight is fixed DT curves. Every visible state rides existing entity fields
// (cast bars, pos.y, facing, an aura, the half's object), so the online client
// mirrors it with no wire or IWorld change.

import {
  climbArc,
  floorUnder,
  glideEase,
  holdAloft,
  placeFlier,
  releaseAloft,
} from '../../mob/flight';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type KnellwyrmFightState } from '../../types';
import type { KnellwyrmKnellState } from './boss_state';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  localOf,
  mechanicDamage,
  spawnCryptObject,
  startBar,
} from './claim';
import {
  inKnellHalf,
  KNELL_HALF_FIRE_TEMPLATE,
  KNELL_HALF_MARK_TEMPLATE,
  KNELL_TUNING,
  KNELLWYRM_AIRBORNE,
  KNELLWYRM_KNELL_BREATH,
  KNELLWYRM_KNELL_FIRE,
  KNELLWYRM_KNELL_LAND,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_KNELL_RISE,
  knellHalfYaw,
  RITE_RING,
} from './ids';

const T = KNELL_TUNING;
const KNELL_CASTS = [
  KNELLWYRM_KNELL_RISE,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_KNELL_BREATH,
  KNELLWYRM_KNELL_LAND,
];

/** The airborne marker (clients read the flight off it and pos.y). */
function markAloft(wyrm: Entity): void {
  if (wyrm.auras.some((a) => a.id === KNELLWYRM_AIRBORNE)) return;
  wyrm.auras.push({
    id: KNELLWYRM_AIRBORNE,
    name: 'Burning Knell',
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: 0,
    sourceId: wyrm.id,
    school: 'fire',
    undispellable: true,
  });
}

/** Take wing now (the cadence and the dev trigger). */
export function beginKnell(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): boolean {
  if (st.knell || st.strafe || wyrm.castingAbility !== null) return false;
  const at = localOf(ctx, inst, wyrm);
  st.knell = {
    phase: 'rise',
    t: 0,
    breaths: 0,
    half: -1,
    objectId: null,
    fromX: at.x,
    fromZ: at.z,
  };
  st.knellTimer = T.every;
  holdAloft(wyrm);
  markAloft(wyrm);
  startBar(wyrm, KNELLWYRM_KNELL_RISE, T.riseSeconds, null, true);
  ctx.emit({
    type: 'spellfx',
    sourceId: wyrm.id,
    targetId: wyrm.id,
    school: 'fire',
    fx: 'windup',
    ability: KNELLWYRM_KNELL_RISE,
  });
  return true;
}

/** Mark the next half: a quarter of the compass from ctx.rng, never the last one. */
function markHalf(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
  k: KnellwyrmKnellState,
): void {
  st.knells = (st.knells ?? 0) + 1;
  k.half = k.half < 0 ? ctx.rng.int(0, 3) : (k.half + ctx.rng.int(1, 3)) % 4;
  k.phase = 'mark';
  k.t = 0;
  const yaw = knellHalfYaw(k.half);
  const obj = spawnCryptObject(
    ctx,
    inst,
    KNELL_HALF_MARK_TEMPLATE,
    'Burning Knell',
    RITE_RING.x,
    RITE_RING.z,
    yaw,
    T.reach,
  );
  k.objectId = obj.id;
  wyrm.facing = yaw;
  startBar(wyrm, KNELLWYRM_KNELL_MARK, T.markSeconds, null, true);
}

/** The fire lands on the marked half. */
function pourFire(ctx: SimContext, inst: InstanceSlot, wyrm: Entity, k: KnellwyrmKnellState): void {
  clearCastIf(wyrm, KNELLWYRM_KNELL_MARK);
  k.phase = 'breath';
  k.t = 0;
  const obj = k.objectId !== null ? ctx.entities.get(k.objectId) : undefined;
  if (obj) obj.templateId = KNELL_HALF_FIRE_TEMPLATE;
  startBar(wyrm, KNELLWYRM_KNELL_BREATH, T.breathSeconds, null, true);
  ctx.emit({
    type: 'spellfx',
    sourceId: wyrm.id,
    targetId: k.objectId ?? wyrm.id,
    school: 'fire',
    fx: 'nova',
    ability: KNELLWYRM_KNELL_FIRE,
  });
  const ringFloor = floorUnder(ctx, inst, RITE_RING.x, RITE_RING.z);
  for (const p of claimPlayers(ctx, inst)) {
    const at = localOf(ctx, inst, p);
    if (!inKnellHalf(k.half, at.x, at.z)) continue;
    // Only the crag top burns: the Choir Loft and the Bone Stair below the
    // rim lie inside the reach on the map but far under the fire.
    if (p.pos.y < ringFloor - KNELL_TUNING.floorBand) continue;
    ctx.dealDamage(
      wyrm,
      p,
      mechanicDamage(ctx, wyrm, T.fireMin, T.fireMax),
      false,
      'fire',
      'Burning Knell',
      'hit',
      true,
    );
  }
}

/** Where it hangs over the ring, `k` of the way through the climb. */
function hover(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  x: number,
  z: number,
  up: number,
) {
  placeFlier(ctx, inst, wyrm, x, z, floorUnder(ctx, inst, x, z) + up);
}

/** One tick of a Burning Knell in flight. Returns true while it owns the wyrm. */
export function stepKnell(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): boolean {
  const k = st.knell;
  if (!k) return false;
  k.t += DT;
  wyrm.swingTimer = Math.max(wyrm.swingTimer, 0.6);
  if (k.phase !== 'land') holdAloft(wyrm);
  const bar = KNELL_CASTS.find((c) => c === wyrm.castingAbility);
  if (bar) wyrm.castRemaining = Math.max(0, wyrm.castRemaining - DT);
  switch (k.phase) {
    case 'rise': {
      const e = glideEase(k.t / T.riseSeconds);
      const x = k.fromX + (RITE_RING.x - k.fromX) * e;
      const z = k.fromZ + (RITE_RING.z - k.fromZ) * e;
      hover(ctx, inst, wyrm, x, z, climbArc(k.t / T.riseSeconds, T.height));
      if (k.t >= T.riseSeconds - 1e-6) {
        clearCastIf(wyrm, KNELLWYRM_KNELL_RISE);
        markHalf(ctx, inst, wyrm, st, k);
      }
      return true;
    }
    case 'mark':
      hover(ctx, inst, wyrm, RITE_RING.x, RITE_RING.z, T.height);
      wyrm.facing = knellHalfYaw(k.half);
      if (k.t >= T.markSeconds - 1e-6) pourFire(ctx, inst, wyrm, k);
      return true;
    case 'breath':
      hover(ctx, inst, wyrm, RITE_RING.x, RITE_RING.z, T.height);
      wyrm.facing = knellHalfYaw(k.half);
      if (k.t < T.breathSeconds - 1e-6) return true;
      clearCastIf(wyrm, KNELLWYRM_KNELL_BREATH);
      if (k.objectId !== null) dropEncounterObject(ctx, inst, k.objectId);
      k.objectId = null;
      k.breaths++;
      if (k.breaths < T.breaths) {
        markHalf(ctx, inst, wyrm, st, k);
        return true;
      }
      k.phase = 'land';
      k.t = 0;
      startBar(wyrm, KNELLWYRM_KNELL_LAND, T.landSeconds, null, true);
      return true;
    case 'land': {
      holdAloft(wyrm);
      const e = glideEase(k.t / T.landSeconds);
      const x = RITE_RING.x + (k.fromX - RITE_RING.x) * e;
      const z = RITE_RING.z + (k.fromZ - RITE_RING.z) * e;
      hover(ctx, inst, wyrm, x, z, T.height * (1 - e));
      wyrm.facing = Math.atan2(k.fromX - RITE_RING.x, k.fromZ - RITE_RING.z);
      if (k.t < T.landSeconds - 1e-6) return true;
      endKnell(ctx, inst, wyrm, st);
      return false;
    }
  }
}

/** The flight ends (it landed, or the fight ended): grounded and in reach. */
export function endKnell(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): void {
  const k = st.knell;
  if (k?.objectId != null) dropEncounterObject(ctx, inst, k.objectId);
  st.knell = null;
  for (const id of KNELL_CASTS) clearCastIf(wyrm, id);
  dropAuraById(wyrm, KNELLWYRM_AIRBORNE);
  if (wyrm.dead) return;
  releaseAloft(wyrm);
  const at = localOf(ctx, inst, wyrm);
  wyrm.pos.y = floorUnder(ctx, inst, at.x, at.z);
  ctx.grid.update(wyrm);
}

/** One tick of the heroic Burning Knell for an engaged wyrm: the flight in
 *  progress, or the clock to the next one. Returns true while it flies (the
 *  wyrm's other mechanics wait). */
export function tickKnell(
  ctx: SimContext,
  inst: InstanceSlot,
  wyrm: Entity,
  st: KnellwyrmFightState,
): boolean {
  // A flight in progress always finishes (a dev trigger may start one on normal).
  if (st.knell) return stepKnell(ctx, inst, wyrm, st);
  if (inst.difficulty !== 'heroic') return false;
  st.knellTimer = (st.knellTimer ?? T.first) - DT;
  if (st.knellTimer > 0 || st.strafe || wyrm.castingAbility !== null || ctx.isStunned(wyrm))
    return false;
  return beginKnell(ctx, inst, wyrm, st);
}
