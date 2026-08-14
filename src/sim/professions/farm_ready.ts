// The farming ready notice: the ONE place a finished plot turns into a
// personal, text-free farmReady event.
//
// TWO CALLERS, ONE PREDICATE. The login check (Sim.addPlayer, so a farmer who
// comes back to a finished crop hears about it on the join itself rather than
// up to a second later) and the 1 Hz tick sweep (updateFarming in farming.ts,
// so a crop that finishes while its owner is standing in the allotment is
// announced without a relog) both call notifyFarmReady below. Writing the
// transition test twice is the failure mode this module exists to prevent:
// two copies could disagree about which plots have already been announced.
//
// DRAW-FREE, the farming draw contract's "the tick sweep draws nothing" and
// "login / save+load draws nothing" clauses (see the contract in farming.ts).
// The whole decision is a comparison of stored timestamps against the host's
// own clock plus the ALREADY-DRAWN survival roll, read through the same
// farmPlotStatus the wire projection is built from, so no host can fork here
// and the notice can never disagree with the status the player sees on the
// bed.
//
// THE FLAG IS THE WHOLE ONCE-ONLY MECHANISM. `notified` is flipped BEFORE the
// emit (the mailWelcomed idiom) and round-trips through CharacterState
// (farm_persist.ts), so no relog, and no second sweep, can re-announce a plot
// a farmer has already been told about. The only thing that re-arms a bed is
// planting in it again: plantCrop writes notified: false with the new plot.
// Nothing here ever clears the flag.

import { farmCropTier } from '../content/farm_crops';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { farmPlotStatus } from './farm_projection';

/** Announce every plot of this player that has FINISHED since the last look:
 *  one event carrying the counts, or nothing at all.
 *
 *  Counts, never plot state: the event payload is digested by the parity
 *  golden, and the fplot projection is already the one place a client learns
 *  which bed holds what, so this says only how many beds are waiting. A
 *  withered plot counts too, and honestly: it is finished, it needs clearing,
 *  and the projection already shows it as withered, so naming it here leaks
 *  nothing the bed does not already say. `withered` is omitted when zero (the
 *  seedBackCount idiom), which keeps the common all-ready notice the smaller
 *  frame.
 *
 *  Allocation-light on the sweep path: an empty plot map leaves immediately
 *  (a non-farmer costs one size read and allocates nothing), the counting
 *  walk uses plain locals over the map's values() iterator, and the one
 *  OBJECT this can allocate is allocated only when a plot actually
 *  transitioned. */
export function notifyFarmReady(ctx: SimContext, meta: PlayerMeta): void {
  if (meta.farmPlots.size === 0) return;
  const nowMs = ctx.lockoutNowMs();
  // CURRENT proficiency, the projection's own rule: out-levelling a crop
  // retires its risk retroactively, so a plot that would have withered at a
  // lower skill is announced as ready, exactly as the bed renders it.
  const skill = meta.gatheringProficiency.farming ?? 0;
  let ready = 0;
  let withered = 0;
  for (const plot of meta.farmPlots.values()) {
    if (plot.notified) continue;
    const status = farmPlotStatus(plot, nowMs, skill, farmCropTier(plot.cropId));
    if (status === 'growing') continue;
    // Flipped BEFORE the counts are used to emit anything (the mailWelcomed
    // ordering): a throw between here and the emit costs one notice, never a
    // repeating one.
    plot.notified = true;
    if (status === 'withered') withered++;
    else ready++;
  }
  if (ready + withered === 0) return;
  ctx.emit(
    withered > 0
      ? { type: 'farmReady', pid: meta.entityId, ready, withered }
      : { type: 'farmReady', pid: meta.entityId, ready },
  );
}
