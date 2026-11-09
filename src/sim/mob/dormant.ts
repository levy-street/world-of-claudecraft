// Dormant: a mob that sleeps until it is woken (MobTemplate.dormant).
//
// The Smith's Heart's Hammer Vein Warders lie on the gallery landings as heaps of stone and
// stand up only when the raid reaches them. Asleep, a dormant mob is still hostile and
// attackable (unlike a slumbering world boss, mob/slumber.ts, which is neutral all night):
// the raid can open on it from range. What it cannot be is fought at full strength: it wears
// a ward (dormant_state.ts) that stops most of every blow until it has stood up.
//
// The wake: anything that pulls it moves it off 'idle', and the next tick that sees it pulled
// wakes it. That covers a hostile player inside its aggro radius (the ordinary idle scan in
// mob/locomotion.ts finds them and engages through ctx.aggroMob), a blow (which engages it the
// same way), and a packmate's pull (which writes its state directly, never through aggroMob).
// The wake holds the AI for `riseSeconds` while the body stands up (the renderer plays
// ClipMap.wake on the asleep-to-awake edge), with the ward still on; then the ward lifts and
// the AI opens on whoever tops the hate table the raid built meanwhile. The hold returns
// before the AI rather than forcing the mob back to 'idle' (as mob/slumber.ts does), so a blow
// on a rising mob finds it engaged already and never re-runs the pull and its pack scan.
// Drivers beside the AI respect the same hold (dormant_state.ts dormantHold).
//
// A fresh spawn is born asleep (entity.ts createMob); an evade home (locomotion.ts
// resetEvadingMob), an in-place respawn (lifecycle.ts) and a rise that finds nobody to fight
// put it back to sleep. Its corpse is never asleep (combat/damage.ts handleDeath).
// Determinism (sim core): no clock, no rng.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { type DormantDef, holdDormantWard, liftDormantWard, putDormant } from './dormant_state';
import { highestThreatTarget } from './targeting';

/**
 * What the dispatcher should do after this tick:
 *  - 'awake':  run the ordinary mob AI. A sleeper nobody has pulled is 'awake' here on
 *              purpose: its idle scan is what finds a player in reach (it never wanders).
 *  - 'rising': standing up after a wake; nothing else this tick.
 */
export type DormantTick = 'awake' | 'rising';

/** The per-tick driver, called from the mob dispatcher before any AI runs. */
export function tickDormant(ctx: SimContext, mob: Entity): DormantTick {
  const def = MOBS[mob.templateId]?.dormant;
  if (!def) return 'awake';
  if (mob.asleep) {
    if (!pulled(mob)) {
      holdDormantWard(mob, def);
      return 'awake';
    }
    mob.asleep = false;
    mob.dormantRise = def.riseSeconds;
  }
  if (mob.dormantRise !== undefined && mob.dormantRise > 0) return rise(ctx, mob, def);
  return 'awake';
}

/** Anything that engaged it: the idle scan's pull, a blow, a pack pull, a taunt. */
function pulled(mob: Entity): boolean {
  return (
    mob.aiState !== 'idle' || mob.inCombat || mob.threat.size > 0 || mob.aggroTargetId !== null
  );
}

function rise(ctx: SimContext, mob: Entity, def: DormantDef): DormantTick {
  holdDormantWard(mob, def);
  mob.dormantRise = Math.max(0, (mob.dormantRise ?? 0) - DT);
  if (mob.dormantRise > 0) return 'rising';
  // Standing. The ward goes with the hold, and the AI opens on whoever tops the table the
  // raid built while it stood up (a target who left meanwhile is replaced). A mob already
  // sent home (its pull wiped while it rose) keeps evading, and the ordinary retarget sends
  // a chaser with nobody left home too, where it lies down again.
  liftDormantWard(mob);
  const opener = highestThreatTarget(ctx, mob);
  if (opener && mob.aiState !== 'evade') {
    mob.aggroTargetId = opener.id;
    mob.aiState = 'chase';
    mob.inCombat = true;
  } else if (!opener && mob.aiState === 'idle') {
    // Woken by something that never pulled it into a fight (another mob's blow with no
    // threat behind it, a combat reset mid-rise): nobody to fight, so it lies straight down.
    putDormant(mob, def);
  }
  return 'rising';
}
