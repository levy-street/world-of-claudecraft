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
//
// THE WITHERED-THEN-READY CORRECTION (masterwrought Phase 18). A plot
// announced withered can later PROJECT ready: farmPlotStatus reads CURRENT
// proficiency, and out-levelling a crop retires its risk retroactively
// (monotonic, one direction only, never ready-to-withered). The bed itself
// always showed the truth; the notice was the one stale surface. The sweep
// therefore keeps a transient per-player memory of which beds' notice said
// withered (PlayerMeta.farmWitheredAnnounced, session-only) and, when such a
// plot re-projects ready, counts it into the SAME farmReady frame as a fresh
// ready bed: "N beds ready" after "withered" IS the correction, so no new
// event type, no new wire field, and no client change exist anywhere in this
// feature. The memory needs no persistence: a notified plot that currently
// reads withered was announced withered (monotonicity again), so every sweep
// reseeds it from plain state and a relog keeps every correction whose flip
// happens IN a session. The one flip a relog does lose: a skill rise that
// lands between sessions (the load-time proficiency_display_heal bump is the
// live case) reconstructs the plot as notified-and-ready against an empty
// memory, so that correction is skipped; the bed still shows the truth, and
// the notice was never the durable surface. Corrections ride the once-only
// seam too: the set entry is removed as the correction emits, so a bed
// corrects at most once per cycle. Re-withering cannot happen in play
// (proficiency never decrements), with one out-of-play exception: the
// one-time mastery_reset zeroes skills at load, so a plot corrected in the
// prior session can read withered again and re-seed the memory, and a later
// skill rise would then correct it a second time: worst case one duplicate
// correction PER BED for a character that lived through the reset, NOT one
// duplicate frame for the character. Each bed clears its own survival
// threshold (its crop tier, its stored roll, its compost and watch), so beds
// re-withered by the reset can correct on DIFFERENT skill rises and land in
// as many separate sweeps; only the corrections that fall in the SAME sweep
// fold into one farmReady frame.

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
 *  walk uses plain locals over the map's entries iterator, and the one
 *  OBJECT this can allocate is allocated only when a plot actually
 *  transitioned or corrected. */
export function notifyFarmReady(ctx: SimContext, meta: PlayerMeta): void {
  const announced = meta.farmWitheredAnnounced;
  if (meta.farmPlots.size === 0) {
    // A harvested-out allotment leaves no bed to correct; drop any stale
    // memory so a later replant can never inherit it.
    if (announced.size > 0) announced.clear();
    return;
  }
  const nowMs = ctx.lockoutNowMs();
  // CURRENT proficiency, the projection's own rule: out-levelling a crop
  // retires its risk retroactively, so a plot that would have withered at a
  // lower skill is announced as ready, exactly as the bed renders it.
  const skill = meta.gatheringProficiency.farming ?? 0;
  let ready = 0;
  let withered = 0;
  for (const [bedId, plot] of meta.farmPlots) {
    if (plot.notified) {
      // The correction walk (see the header): a notified plot that reads
      // withered seeds the memory (idempotent; this is also the relog
      // reconstruction), and one that reads ready while the memory holds its
      // bed emits the correction by joining the ready count, once.
      const status = farmPlotStatus(plot, nowMs, skill, farmCropTier(plot.cropId));
      if (status === 'withered') announced.add(bedId);
      else if (status === 'ready' && announced.delete(bedId)) ready++;
      continue;
    }
    // A fresh, unannounced plot in this bed: any memory entry is a stale
    // leftover from a previous cycle (the harvest emptied the bed and a
    // replant re-armed it), never this crop's.
    announced.delete(bedId);
    const status = farmPlotStatus(plot, nowMs, skill, farmCropTier(plot.cropId));
    if (status === 'growing') continue;
    // Flipped BEFORE the counts are used to emit anything (the mailWelcomed
    // ordering): a throw between here and the emit costs the plots already
    // flipped in this pass their notice and splits the rest onto the next
    // sweep, never a repeating one. (Practically unreachable: the only
    // callees inside this loop are a stored-roll comparison and a table read.)
    plot.notified = true;
    if (status === 'withered') {
      withered++;
      announced.add(bedId);
    } else ready++;
  }
  // Prune memory entries whose bed no longer holds a plot (harvested away):
  // bounded by the authored bed count, and only paid while entries exist.
  if (announced.size > 0) {
    for (const bedId of announced) {
      if (!meta.farmPlots.has(bedId)) announced.delete(bedId);
    }
  }
  if (ready + withered === 0) return;
  // The notice is TRANSIENT by design (state.md deviation (bb)): a farmer
  // whose socket is not open when this frame is routed (the linkdead grace,
  // or a disconnect inside the one tick between addPlayer and its drain)
  // never hears it, and the flag above stays flipped, so nothing repeats it.
  // Accepted because every durable surface (journal, pins, the bed's own
  // status) shows the same truth on resume; maintainer read owed.
  ctx.emit(
    withered > 0
      ? { type: 'farmReady', pid: meta.entityId, ready, withered }
      : { type: 'farmReady', pid: meta.entityId, ready },
  );
}
