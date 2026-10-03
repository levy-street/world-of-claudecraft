// A telegraphed area never moves with its caster. A dungeon mob plants its
// feet for the whole bar of an area cast (a screech, a wing gust, a tail lash,
// a lane, a breath cone) and holds the facing the bar began with, so the ring,
// the cone or the lane stays where it was drawn and stepping out of it is the
// counterplay. The mob AI still walks and turns the mob every tick; this runs
// after it (the trash kit's pass) and undoes the step, the way the Tideglass
// Colossus holds its ground for its own bars.
//
// The hold rides `Entity.castHold` and dies with the bar (it lands, breaks,
// or the pull ends). Zero rng.

import { MOBS } from '../../data';
import type { SimContext } from '../../sim_context';
import type { Entity, MobTemplate } from '../../types';

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
): boolean {
  if (!template) return false;
  const kit = template.trashKit;
  return (
    (breath && template.breathCone?.castId === castId) ||
    kit?.screech?.castId === castId ||
    kit?.wingGust?.castId === castId ||
    kit?.tailLash?.castId === castId ||
    kit?.line?.castId === castId ||
    kit?.toss?.castId === castId
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
 * One tick of the hold, after the mob AI: begin it on the first tick of an
 * area cast's bar, keep the mob on its spot and its facing while the bar
 * runs, and drop it when the bar is gone.
 */
export function holdAreaCast(ctx: SimContext, mob: Entity, breath: boolean): void {
  const castId = mob.castingAbility;
  if (castId === null || !isPlantedCast(MOBS[mob.templateId], castId, breath)) {
    mob.castHold = undefined;
    return;
  }
  if (mob.castHold?.castId !== castId) {
    mob.castHold = { castId, x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, facing: mob.facing };
    return;
  }
  if (restoreCastHold(mob)) ctx.rebucket(mob);
}
