// Farming wire surface: the farming and feast command bodies (plant_crop,
// harvest_crop, convert_husks, place_feast, consume_feast) plus the fplot
// self-snapshot row. All were extracted whole from server/game.ts during the
// v0.38.0 release sync to heal the monolith ratchet. The case labels stay
// in game.ts. The command-schema suite scans that switch for the dispatch universe, and the
// labels ARE the protocol surface. This module owns the frame guards and the
// fplot gating doctrine; the sim stays the single definition of legality.

import type { Sim } from '../src/sim/sim';

/** Routes one farming command frame. `msg` is the already-parsed client
 *  frame (game.ts's ClientMessage, structurally a string-keyed record); every
 *  field is re-guarded here exactly as dispatchMessage guards its own cases.
 *  Returns whether the frame REACHED the sim (its guards passed and a sim
 *  method was invoked): the dispatch's heavy-self mark for the arm-marked
 *  farming members rides this answer (server/heavy_self.ts
 *  HEAVY_SELF_ARM_MARKED_CMDS), so a frame refused HERE never buys a heavy
 *  self re-serialize. The sim's own verdict is not visible here and is not
 *  claimed: true means invoked, never accepted. */
export function dispatchFarmingCommand(
  sim: Sim,
  msg: Record<string, unknown>,
  pid: number,
): boolean {
  switch (msg.cmd) {
    case 'plant_crop':
      // Farming's growth phase. TYPE boundary only: the sim is the single
      // definition of legality, and it re-validates the bed id against
      // FARM_BED_IDS, the crop id against the crop catalog, that the bed is
      // free for THIS player, the skill threshold, the seed in the
      // sender's own bags, that every REQUESTED knob can be paid from
      // those bags, and the hoe gate (step 12 in plantCrop: the
      // wield-filtered hoe tier via bestWieldableGatherToolTierOrNone must
      // cover the crop's tier, refused as farmDenied reason 'tool').
      // Nothing here normalizes or defaults an
      // id, for the same reason dispatchMessage's slot_tool_effect case
      // states: laundering an unknown id
      // would hand the sim a value it never saw and make the two hosts
      // disagree about the same message. Every refusal answers with a
      // pid-scoped text-free SimEvent. `fplot` sits behind the heavy self
      // gate since the growth phase made its non-empty arm live, so the new
      // plot row reaches this client on the next snapshot rather than a
      // per-tick diff: the seed spend bumps meta.wireRev (a heavyDue input)
      // and `plant_crop` is also a HEAVY_SELF_CMDS member, either of which is
      // sufficient. See the HEAVY_SELF_CMDS entry for which does the work.
      //
      // The knob fields (the knobs phase) are guarded PER FIELD like the
      // ids: present-but-not-boolean refuses the whole frame, because
      // coercing a junk value into a knob choice would be the same
      // laundering the id rule forbids. Absent and false are the SAME
      // protocol statement (knob not requested; the client omits unset
      // knobs so a plain plant's frame stays byte-identical to the pre-knob
      // wire), so the strict `=== true` mapping below is the frame
      // contract, not a default.
      if (
        typeof msg.bed === 'string' &&
        typeof msg.crop === 'string' &&
        (msg.compost === undefined || typeof msg.compost === 'boolean') &&
        (msg.watch === undefined || typeof msg.watch === 'boolean') &&
        (msg.tonic === undefined || typeof msg.tonic === 'boolean')
      ) {
        sim.plantCrop(
          msg.bed,
          msg.crop,
          {
            compost: msg.compost === true,
            watch: msg.watch === true,
            tonic: msg.tonic === true,
          },
          pid,
        );
        return true;
      }
      return false;
    case 'harvest_crop':
      // The other half of the same pair. The yield comes entirely from the
      // hidden slots pre-rolled at plant time, so this frame cannot
      // influence what it pays out: it names a bed and nothing else.
      if (typeof msg.bed === 'string') {
        sim.harvestCrop(msg.bed, pid);
        return true;
      }
      return false;
    case 'convert_husks':
      // Farming's knobs phase: trade withered husks for compost. NO payload
      // to guard: the ratio, the batch count and both item ids resolve
      // sim-side from the sender's own bags, and the refusals (too few
      // husks, or no farmer NPC in reach: the go-live's range gate lives in
      // the sim body) answer with the pid-scoped text-free farmDenied event.
      sim.convertHusks(pid);
      return true;
    case 'place_feast':
      // The shared feast's place verb. The one feast item id, its charge
      // count, its expiry, and the one-active-feast-per-placer rule all
      // resolve sim-side (src/sim/professions/feast.ts) from the sender's own
      // bags and the live feast table, so nothing on this frame decides an
      // outcome. The one optional field it carries is slot, WHICH bag copy to
      // spend: a TYPE boundary only (a non-negative integer), because the sim
      // re-resolves the index against its own inventory and answers a mismatch
      // with farmDenied no_feast. Omission keeps the original id-only meaning;
      // a present malformed value refuses the frame instead of being laundered
      // into omission. Every sim refusal answers with a pid-scoped text-free
      // farmDenied event.
      if (
        msg.slot !== undefined &&
        (typeof msg.slot !== 'number' || !Number.isInteger(msg.slot) || msg.slot < 0)
      ) {
        return false;
      }
      sim.placeFeast(pid, msg.slot as number | undefined);
      return true;
    case 'consume_feast':
      // The shared feast's eat verb: the feast ENTITY id and nothing else.
      // TYPE boundary only (an integer; the sim validates liveness,
      // expiry, charges, range, and the once-per-player ledger, and answers
      // every refusal with the pid-scoped text-free farmDenied event).
      // Nothing here normalizes or defaults the id, for the dispatch
      // switch's own stated laundering reason.
      if (typeof msg.id === 'number' && Number.isInteger(msg.id)) {
        sim.consumeFeast(msg.id, pid);
        return true;
      }
      return false;
    default:
      return false;
  }
}

/** Appends the viewer's own farm plots (IWorld `myFarmPlots`) to a building
 *  self snapshot. Wire key `fplot`; see TERSE_TO_IWORLD/ALL_DELTA_KEYS in
 *  tests/snapshots.test.ts. The projection
 *  (src/sim/professions/farm_projection.ts) picks its fields explicitly, so
 *  the hidden pre-rolled outcome slots (survivalRoll, yieldSeed) never reach
 *  a client; tests/snapshots.test.ts pins that absence over this path.
 *
 *  HEAVY-GATED as of the growth phase, which is when this stopped being
 *  free. While no one could plant, the read returned the shared frozen
 *  empty projection and the whole cost was a constant compare. Now a
 *  farming session rebuilds, sorts and survival-evaluates up to one row
 *  PER AUTHORED BED and stringifies the result at 20 Hz, purely to
 *  discover that the bytes are identical to last tick's between the two
 *  transitions that can actually move them. That is the "revisit if the
 *  rows grow" trigger the patches-and-plots phase wrote down.
 *
 *  Both writers are covered on the command side: plant_crop and
 *  harvest_crop are HEAVY_SELF_CMDS members, so the row set is fresh in
 *  the very next snapshot after either. The one mutation with no command
 *  behind it is a plot ripening on its own timer (growing to ready), and
 *  since the ready-notice phase that arm has its own event: the 1 Hz sweep
 *  flips the plot's `notified` flag and emits farmReady, a HEAVY_SELF_EVENTS
 *  member, so the ripened row (its server-computed `status`, the field the
 *  client actually reads; the flipped flag is the byte that makes the row
 *  differ) lands within the same second rather than at the staggered
 *  HEAVY_SELF_REFRESH_TICKS backstop. The backstop still covers the
 *  once-notified plot, whose rows no longer move at all. `status` is
 *  computed by the authority at send time either way, so nothing here is
 *  predicted.
 *
 *  The empty arm compares the constant '[]' directly (byte-identical to
 *  maybe(...)): the empty read is the shared frozen EMPTY_FARM_PLOT_VIEWS
 *  (no per-call allocation since the Phase 2 QA fix), and skipping the
 *  stringify of an empty projection is still the cheaper arm. */
export function appendFarmPlotsWire(
  sim: Sim,
  pid: number,
  maybe: (key: string, value: unknown) => void,
  maybeSerialized: (key: string, serialized: string) => void,
): void {
  const fplotRows = sim.farmPlotsFor(pid);
  if (fplotRows.length === 0) maybeSerialized('fplot', '[]');
  else maybe('fplot', fplotRows);
}
