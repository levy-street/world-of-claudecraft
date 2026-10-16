// The Idol's Breath of Zulgar's final phase (The Idol Wakes, zulgar.ts): the
// stone jaguar behind the terrace breathes over one HALF of it at a time.
//
//   The warning  5 s after the idol wakes, and every 10 s after, one half of
//                the terrace (east or west of the centre line that runs from
//                the stair to the idol's maw) is marked on the floor for 5 s:
//                an encounter object on the centre line whose `facing` points
//                across the marked half and whose cast bar is the warning.
//   The breath   as the warning ends the jade breath pours over that half:
//                everyone on the terrace standing in it takes 300 to 360. The
//                object flips to the breath's own template and plays out for
//                1.6 s (its look; the hit is the landing), then goes.
//   The halves   alternate: the first is hashed (the boss id and the pull's
//                cast count), every one after is the other side.
//   Heroic       the breath also snuffs every lit sun glyph of its half.
//
// The centre line itself is safe (the edge the floor paints is the edge
// tested). Deterministic: the only rng draws are the damage rolls, in
// terrace-player (entity-id) order. Every visible state rides the object (its
// template, facing, scale and cast bar) and one `spellfx` at the warning and
// one at the landing.

import { SHRINE_TERRACE } from '../../content/wildheart_basin_layout';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type ZulgarFightState } from '../../types';
import { dropEncounterObject, localOf, mechanicDamage, spawnBasinObject } from './claim';
import {
  type IdolBreathSide,
  idolBreathFacing,
  inIdolBreathHalf,
  ZULGAR_TUNING as T,
  WILDHEART_IDOL_BREATH,
  WILDHEART_IDOL_BREATH_WARNING,
  ZULGAR_IDOL_BREATH_LOG,
  ZULGAR_IDOLS_BREATH,
} from './ids';
import { snuffGlyphsInHalf } from './zulgar_glyphs';
import { setObjectClock, shrinePlayers } from './zulgar_terrace';

/** The terrace's extent (instance-local): where the centre line runs and how
 *  far a half reaches from it. */
export const IDOL_BREATH_FIELD = (() => {
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let reach = 0;
  for (const [x, z] of SHRINE_TERRACE.points) {
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    reach = Math.max(reach, Math.abs(x));
  }
  return { x: 0, z: (minZ + maxZ) / 2, minZ, maxZ, reach } as const;
})();

/** The idol wakes: its breath's clock starts, the first half hashed. */
export function wakeIdolBreath(z: Entity, st: ZulgarFightState): void {
  st.idol = {
    timer: T.breathFirst,
    side: kitHash(z.id, st.casts * 13 + 5) % 2 === 0 ? 1 : -1,
    breath: null,
  };
}

/** Mark the next half now (the clock, and the dev trigger). Returns the side
 *  marked, or null while an exhale is already in flight. */
export function startIdolBreath(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): IdolBreathSide | null {
  const idol = st.idol;
  if (!idol || idol.breath) return null;
  const side = idol.side;
  idol.side = side === 1 ? -1 : 1;
  idol.timer = T.breathEvery;
  const f = IDOL_BREATH_FIELD;
  const obj = spawnBasinObject(
    ctx,
    inst,
    WILDHEART_IDOL_BREATH_WARNING,
    "Idol's Breath",
    f.x,
    f.z,
    f.reach,
  );
  obj.facing = idolBreathFacing(side);
  obj.prevFacing = obj.facing;
  setObjectClock(obj, ZULGAR_IDOLS_BREATH, T.breathWarning, T.breathWarning);
  idol.breath = { objectId: obj.id, side, left: T.breathWarning, landed: false };
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: obj.id,
    school: 'nature',
    fx: 'windup',
    ability: ZULGAR_IDOLS_BREATH,
  });
  ctx.emit({ type: 'log', text: ZULGAR_IDOL_BREATH_LOG, color: '#6ff0b0', entityId: z.id });
  return side;
}

/** The warning ended: the breath lands on its half. Returns how many it hit. */
function landIdolBreath(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
  side: IdolBreathSide,
  obj: Entity | undefined,
): number {
  if (obj) {
    obj.templateId = WILDHEART_IDOL_BREATH;
    setObjectClock(obj, ZULGAR_IDOLS_BREATH, T.breathLinger, T.breathLinger);
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: obj?.id ?? z.id,
    school: 'nature',
    fx: 'nova',
    ability: ZULGAR_IDOLS_BREATH,
  });
  let n = 0;
  for (const p of shrinePlayers(ctx, inst)) {
    if (!inIdolBreathHalf(localOf(ctx, inst, p).x, side)) continue;
    ctx.dealDamage(
      z,
      p,
      mechanicDamage(ctx, z, T.breathMin, T.breathMax),
      false,
      'nature',
      "Idol's Breath",
      'hit',
      true,
    );
    n++;
  }
  if (inst.difficulty === 'heroic') snuffGlyphsInHalf(ctx, st, side);
  return n;
}

/** One tick of the idol: the exhale in flight, then the clock to the next. */
export function stepIdolBreath(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): void {
  const idol = st.idol;
  if (!idol) return;
  idol.timer -= DT;
  const b = idol.breath;
  if (b) {
    b.left -= DT;
    const obj = ctx.entities.get(b.objectId);
    if (obj) obj.castRemaining = Math.max(0, b.left);
    if (b.left > 1e-9) return;
    if (!b.landed) {
      b.landed = true;
      b.left = T.breathLinger;
      landIdolBreath(ctx, inst, z, st, b.side, obj);
      return;
    }
    dropEncounterObject(ctx, inst, b.objectId);
    idol.breath = null;
  }
  if (idol.timer <= 0) startIdolBreath(ctx, inst, z, st);
}

/** The idol sleeps again (the pull ended): its breath and its clock go. */
export function clearIdolBreath(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState): void {
  if (st.idol?.breath) dropEncounterObject(ctx, inst, st.idol.breath.objectId);
  st.idol = null;
}
