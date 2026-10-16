// The Proving Shore ferry bells (tutorial island): the crossing is a CLICKED
// world object, never a walk-in trigger, so nobody is teleported by wandering
// over a spot. Two bells share one itemId (content/proving_shore.ts
// PROVING_SHORE_OBJECTS): the Old Pier's bell sets the player down in
// Eastbrook town beside the spawn square, and the vale west strand's twin
// rings a returning player back to the island arrival for a refresher.
// interaction.ts routes the click here BEFORE the quest-pickup path (the
// firebottle_hut precedent), so a bare click always sails instead of denying.
//
// Draws ZERO rng (displacePlayer only moves and emits), so the click's tick
// position cannot fork the deterministic draw order. `src/sim`-pure.

import {
  isOnProvingShore,
  PROVING_SHORE_ARRIVAL,
  PROVING_SHORE_QUEST_ORDER,
} from '../content/proving_shore';
import { bumpDeedStat } from '../deeds';
import { displacePlayer } from '../displacement';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const FERRY_BELL_OBJECT_ID = 'ps_ferry_bell';

/** Where the island bell sets a graduate down: the civic square, a few
 *  strides north of the return bell at (-7.5, -100), facing west across the
 *  square past the Ravenpost mailbox and the monument and down the main
 *  street, so the first thing a graduate sees is the town, not the sea. Well
 *  clear of the authored spawn at (-94, -58), so an arrival never stacks on a
 *  fresh spawn. The optional golden guidance leads from here to Marshal on
 *  the civic square.
 *
 *  Moved 4.3 yd north-west in the Tidehold rebuild: the Weekly Vault took the
 *  green south of the square, and the old point at (-4.5, -101.5) stood a
 *  stride off its front wall, on the weekly emissary's spot, with the chase
 *  camera inside the hall. From here the camera settles in the open square,
 *  and the walk to each starter quest giver is clear
 *  (tests/eastbrook_combat_giver_visibility.test.ts). */
export const FERRY_BELL_TOWN_LANDING = { x: -6, z: -97.5, facing: -1.3 } as const;

/** Whether this character has never worked the shore: no Proving Shore quest
 *  in the log and none turned in. The arrival note is a TEACHING moment (it
 *  carries the walk and talk controls), so it belongs to a character who has
 *  not started the rail, not to a device that has seen it once. A veteran
 *  riding back for a refresher keeps their screen clear. */
export function isFirstIslandVisit(meta: PlayerMeta): boolean {
  for (const questId of PROVING_SHORE_QUEST_ORDER) {
    if (meta.questLog.has(questId) || meta.questsDone.has(questId)) return false;
  }
  return true;
}

/** The shared island-arrival marker, emitted by BOTH ferry routes (the
 *  compulsory greeting ferry and the town bell below).
 *  Text-free: the client renders Odo's welcome note off `firstVisit`. */
export function emitIslandArrival(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  ctx.emit({ type: 'ferryIslandArrival', pid: p.id, firstVisit: isFirstIslandVisit(meta) });
}

/** Ring a ferry bell: travel to the OTHER shore, decided by which side of
 *  the strait the clicked bell stands on. In combat the crossing refuses
 *  (the shared ferry-refusal wording), so the bell can never be a combat
 *  exit. Always returns true: the click was the bell's, even when refused. */
export function tryRingFerryBell(
  ctx: SimContext,
  obj: Entity,
  p: Entity,
  meta: PlayerMeta,
): boolean {
  if (p.inCombat) {
    ctx.error(p.id, 'You cannot set sail from here.');
    return true;
  }
  if (isOnProvingShore(obj.pos.x, obj.pos.z)) {
    displacePlayer(
      ctx,
      p,
      FERRY_BELL_TOWN_LANDING,
      'The crossing takes hold, and Eastbrook Vale spreads out before you.',
    );
    // Text-free homecoming marker: the HUD points out the town's twin bell
    // the first time (its own localStorage one-shot), in case the ride was a
    // misclick. Emitted every ride; the one-shot is presentation-only.
    ctx.emit({ type: 'ferryBellHome', pid: p.id });
    // The graduation moment ("Ready for an Adventure",
    // content/deeds.ts prog_ready_for_an_adventure): this home ride with the
    // whole rail handed in. The rail is strict (each quest requires the
    // previous), so its final quest in questsDone means all of it is.
    const finalQuestId = PROVING_SHORE_QUEST_ORDER[PROVING_SHORE_QUEST_ORDER.length - 1];
    if (meta.questsDone.has(finalQuestId)) {
      bumpDeedStat(ctx, meta, 'tutorialGraduations', 1);
    }
  } else {
    displacePlayer(
      ctx,
      p,
      PROVING_SHORE_ARRIVAL,
      'The ferry bell tolls, and the Proving Shore rises to meet you.',
    );
    // Same arrival marker the greeting ferry emits (sim/tutorial/greeting.ts):
    // a returning veteran carries quest history, so firstVisit is false and
    // their screen stays clear.
    emitIslandArrival(ctx, p, meta);
  }
  return true;
}
