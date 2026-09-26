// Which program families (../cast_vfx_family.ts) the painter can draw a cast
// of this ability from: the mask the cast gate admits it on. Every painter
// cast draws the engine. An authored Warrior appearance (its choreography
// tables, a `physical` spec, or any Warrior ability) can also reach the kit's
// pools, which only the Warrior modules spawn into, so it waits on the kit
// too; no other class ever does. Deliberately a union over every branch the
// sequencer can take for the id (tier, crit, target, anchors), resolved at
// the family level where it is exact: over-approximating only delays a cast,
// and a pool that is reached anyway refuses the spawn and counts a
// requirement miss (tests/ability_vfx_cast_requirements.test.ts drives every
// spec'd id through the real painter to keep this honest).
//
// A bespoke visual that joins the gate adds its family's bit here for its own
// ability ids.

import { ABILITIES } from '../../sim/data';
import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../cast_vfx_family';
import { WARRIOR_VFX_FULL_SPECS } from '../warrior_vfx_specs';
import { abilityVfxFullSpecFor } from './encounter_specs';

/** The families every Warrior-only read the painter holds per frame waits on
 *  (the readiness, Fury, power and guard holds). The control marks draw on
 *  the engine alone (WARRIOR_CONTROL_MARK_REQUIREMENT). */
export const WARRIOR_KIT_REQUIREMENT = CAST_VFX_ENGINE | CAST_VFX_KIT;

const MEMO_CAP = 1024;
const memo = new Map<string, number>();

/** True when a cast of this id can reach the Warrior kit's pools. */
export function drawsWarriorKit(abilityId: string): boolean {
  return (
    Object.hasOwn(WARRIOR_VFX_FULL_SPECS, abilityId) ||
    ABILITIES[abilityId]?.class === 'warrior' ||
    abilityVfxFullSpecFor(abilityId)?.physical !== undefined
  );
}

/** The requirement mask for a cast of `abilityId`, memoized per id: one map
 *  read per cast, never a spec walk on a live frame. */
export function castVfxRequirement(abilityId: string): number {
  let mask = memo.get(abilityId);
  if (mask === undefined) {
    mask = drawsWarriorKit(abilityId) ? WARRIOR_KIT_REQUIREMENT : CAST_VFX_ENGINE;
    if (memo.size < MEMO_CAP) memo.set(abilityId, mask);
  }
  return mask;
}
