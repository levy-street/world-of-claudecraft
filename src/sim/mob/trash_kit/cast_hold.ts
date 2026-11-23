// A telegraphed area never moves with its caster. A dungeon mob plants its
// feet for the whole bar of an area cast (a screech, a wing gust, a tail lash,
// a lane, a breath cone) and holds the facing the bar began with, so the ring,
// the cone or the lane stays where it was drawn and stepping out of it is the
// counterplay. The mob AI still walks and turns the mob every tick; this runs
// after it (the trash kit's pass) and undoes the step, the way the Tideglass
// Colossus holds its ground for its own bars.
//
// The hold rides `Entity.castHold` and dies with the bar (it lands, breaks,
// or the pull ends). Zero rng. A scripted boss bar (an encounter's own bar,
// today Sexton Marrow's) takes the same hold through beginCastHold /
// keepCastHold, never a re-snap to wherever the mob AI just walked it.

import { MOBS } from '../../data';
import type { SimContext } from '../../sim_context';
import type { Entity, MobTemplate, TrashKitDef } from '../../types';

/** Is `castId` one of the template's area casts (the ones it plants for)?
 *  A bolt, a raise, a call, a mend, a ward or a lullaby tracks its
 *  target or its allies and is never planted. The trash kit's area casts plant
 *  everywhere; the template's breath cone (a field the open world's dragonkin
 *  and the raids share) only where the dungeon asks (`breath`:
 *  DungeonDef.areaCastsPlant). */
export function isPlantedCast(
  template: MobTemplate | undefined,
  castId: string,
  breath = true,
  devKit?: TrashKitDef,
): boolean {
  if (!template) return false;
  // A dev-lent kit (Entity.devTrashKit) stands in for the template's.
  const kit = devKit ?? template.trashKit;
  return (
    (breath && template.breathCone?.castId === castId) ||
    kit?.screech?.castId === castId ||
    kit?.wingGust?.castId === castId ||
    kit?.tailLash?.castId === castId ||
    kit?.line?.castId === castId ||
    kit?.toss?.castId === castId ||
    kit?.cone?.castId === castId ||
    kit?.nova?.castId === castId ||
    (kit?.nova?.unstoppableCastId !== undefined && kit.nova.unstoppableCastId === castId) ||
    kit?.hook?.castId === castId ||
    // The dungeons' own area casts (kit_extension.ts): the Prism Glare gaze,
    // the Snaring Tongue lane and the Rattling Dread ring.
    kit?.temple?.gaze?.castId === castId ||
    kit?.wildheart?.tongue?.castId === castId ||
    kit?.wildheart?.dread?.castId === castId
  );
}

/** Put the mob back where its area cast began. Returns true when it had
 *  moved (the caller rebuckets it). */
export function restoreCastHold(mob: Entity): boolean {
  const hold = mob.castHold;
  if (!hold || mob.castingAbility !== hold.castId) return false;
  const moved = mob.pos.x !== hold.x || mob.pos.z !== hold.z || mob.pos.y !== hold.y;
  mob.pos.x = hold.x;
  mob.pos.y = hold.y;
  mob.pos.z = hold.z;
  mob.facing = hold.facing;
  return moved;
}

/**
 * A scripted boss bar (an encounter module's own `startBar`) plants the boss
 * where it begins and in the facing it begins with. The encounter calls this
 * as the bar starts, then `keepCastHold` on every tick of the bar (after the
 * mob AI walked and turned it).
 */
export function beginCastHold(mob: Entity, castId: string): void {
  mob.castHold = { castId, x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, facing: mob.facing };
}

/**
 * One tick of a scripted bar's hold: take it now if the bar began without one
 * (a bar started before the hold existed), then stand the boss back on its
 * spot and facing. Returns true when it had moved (the caller re-grids it).
 * A bar that keeps turning to its victim sets its facing after this.
 */
export function keepCastHold(mob: Entity, castId: string): boolean {
  if (mob.castHold?.castId !== castId) beginCastHold(mob, castId);
  return restoreCastHold(mob);
}

/** Drop a scripted bar's hold once the bar is gone (landed, broken, reset). */
export function endCastHold(mob: Entity): void {
  mob.castHold = undefined;
}

/**
 * One tick of the hold, after the mob AI: begin it on the first tick of an
 * area cast's bar, keep the mob on its spot and its facing while the bar
 * runs, and drop it when the bar is gone.
 */
export function holdAreaCast(ctx: SimContext, mob: Entity, breath: boolean): void {
  const castId = mob.castingAbility;
  if (castId === null || !isPlantedCast(MOBS[mob.templateId], castId, breath, mob.devTrashKit)) {
    mob.castHold = undefined;
    return;
  }
  if (mob.castHold?.castId !== castId) {
    mob.castHold = { castId, x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, facing: mob.facing };
    return;
  }
  if (restoreCastHold(mob)) ctx.rebucket(mob);
}
