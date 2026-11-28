// The dormant state's pure half (MobTemplate.dormant; the per-tick driver is mob/dormant.ts):
// the ward a sleeping or rising mob wears, the one way it is put to sleep (shared by createMob,
// every spawn path, the in-place respawn, the evade reset and a rise nobody pulled), and the
// hold other drivers respect. No SimContext, draws no rng.

import { clearThreat } from '../threat';
import type { Aura, Entity, MobTemplate } from '../types';

/** Aura id of the dormant ward. A shield_wall kind: the damage hub's ward rule stops `value`
 *  of every blow from any source and school, damage-over-time ticks included (only an exact
 *  copy of an already-resolved hit skips it), and the frame shows it as a buff with the
 *  generic "reduces all damage taken" line. */
export const DORMANT_AURA_ID = 'mob_dormant';

export type DormantDef = NonNullable<MobTemplate['dormant']>;

/** The ward, permanent while it lasts: asleep, and through the rise until it is lifted. */
function dormantWard(mob: Entity, def: DormantDef): Aura {
  return {
    id: DORMANT_AURA_ID,
    name: def.auraName,
    kind: 'shield_wall',
    value: def.ward,
    remaining: 3600,
    duration: 3600,
    permanent: true,
    stacks: 1,
    sourceId: mob.id,
    school: 'physical',
    undispellable: true,
  };
}

/** Keep the ward on: reconciled every tick rather than trusted, so an aura wipe cannot strip
 *  it while the state stands (the same discipline as mob/slumber.ts and mob/eye_ward.ts). */
export function holdDormantWard(mob: Entity, def: DormantDef): void {
  if (!mob.auras.some((a) => a.id === DORMANT_AURA_ID)) mob.auras.push(dormantWard(mob, def));
}

/** Lift the ward: the rise is over. */
export function liftDormantWard(mob: Entity): void {
  mob.auras = mob.auras.filter((a) => a.id !== DORMANT_AURA_ID);
}

/** Put a dormant mob to sleep where it stands: asleep, no rise running, the ward on, and no
 *  pull left on it (idle, out of combat, no target, an empty hate table, no taunt lock). The
 *  dormant tick reads any of those as a fresh pull, and not every caller clears them first
 *  (resetEvadingMob leaves the target to the evade path). */
export function putDormant(mob: Entity, def: DormantDef): void {
  mob.asleep = true;
  mob.dormantRise = 0;
  mob.aiState = 'idle';
  mob.inCombat = false;
  mob.aggroTargetId = null;
  clearThreat(mob);
  holdDormantWard(mob, def);
}

/** True while the mob sleeps (dormant, or a slumbering boss) or a dormant mob stands up: only
 *  its sleep tick drives it then, so a driver that runs beside the mob AI (a trash kit) treats
 *  it as not engaged yet, even on the tick a pull lands before the wake. */
export function dormantHold(mob: Entity): boolean {
  return mob.asleep === true || (mob.dormantRise ?? 0) > 0;
}
