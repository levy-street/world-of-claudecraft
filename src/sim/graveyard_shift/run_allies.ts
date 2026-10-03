// Morthen's two skeleton allies on a Graveyard Shift run. Temporary necromancy
// undead (summonUndead): owned by the run owner, so the hostility rule resolves
// them to Morthen; never counted as his pet (no pet slot, no pet save); their
// timer outlasts any run, and the teardown dismisses them. They hold passive
// until the party engages (an aggressive pet would pick the waiting party from
// across the chamber and start the fight for him), then fight on the pet AI's
// aggressive stance (pet commands are locked while Morthen). An ally that falls
// close to Morthen feeds his Dread. Draws no rng.

import { despawnTemporaryNecromancyUndead, summonUndead } from '../combat/necromancy';
import { instanceOriginOf } from '../instances/dungeons';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';
import { ALLY_DEATH_DREAD, ALLY_DEATH_DREAD_RADIUS } from './dread';
import { GRAVEYARD_SHIFT_ALLY_SPOTS } from './run_layout';
import type { GraveyardShiftRun } from './run_state';

export const GRAVEYARD_SHIFT_ALLY_TEMPLATE = 'necromancy_skeletal_warrior';
// Longer than any run (the stall timeout ends a run first).
const ALLY_TIMER_SECONDS = 60 * 60;

export function spawnGraveyardShiftAllies(
  ctx: SimContext,
  run: GraveyardShiftRun,
  owner: Entity,
): void {
  const origin = instanceOriginOf(run.slot);
  for (const spot of GRAVEYARD_SHIFT_ALLY_SPOTS) {
    const ally = summonUndead(
      ctx,
      owner,
      GRAVEYARD_SHIFT_ALLY_TEMPLATE,
      true,
      ALLY_TIMER_SECONDS,
      { x: origin.x + spot.x, z: origin.z + spot.z },
      true,
    );
    if (!ally) continue;
    ally.petMode = 'passive';
    run.allyIds.push(ally.id);
  }
}

// Called each run tick: once the party is engaged the allies turn aggressive;
// an ally that has fallen since the last tick, close to a living Morthen,
// grants his Dread once.
export function updateGraveyardShiftAllies(ctx: SimContext, run: GraveyardShiftRun): void {
  const owner = ctx.entities.get(run.ownerPid);
  for (let i = run.allyIds.length - 1; i >= 0; i--) {
    const ally = ctx.entities.get(run.allyIds[i]);
    if (ally && !ally.dead) {
      if (run.engaged) ally.petMode = 'aggressive';
      continue;
    }
    run.allyIds.splice(i, 1);
    if (!ally || !owner || owner.dead || owner.resourceType !== 'dread') continue;
    if (dist2d(ally.pos, owner.pos) > ALLY_DEATH_DREAD_RADIUS) continue;
    owner.resource = Math.min(owner.maxResource, owner.resource + ALLY_DEATH_DREAD);
  }
}

export function dismissGraveyardShiftAllies(ctx: SimContext, run: GraveyardShiftRun): void {
  despawnTemporaryNecromancyUndead(ctx, run.ownerPid);
  run.allyIds.length = 0;
}
