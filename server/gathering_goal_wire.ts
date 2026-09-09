// Intentional Gathering PR4 (docs/prd/intentional-gathering/goal-projection-
// contract.md): the owner-only `ggoal` self-delta, kept as its own leaf
// beside (never inside) gathering_self_wire.ts. That module is the
// tfocus/gprof/tslot/hpref cluster extracted from GameServer.selfWireJson's
// bcastSelf block; this is a distinct feature's single field with its own
// contract, a full-view REPLACEMENT rather than a scalar or map mirror: an
// explicit `null` clears the tracked goal, and `maybe` (the same per-tick
// diff gate every other self field uses) already omits the key entirely when
// unchanged, which is what lets the client preserve its prior mirror on an
// omitted key.
//
// Takes a narrow reader interface (the one per-pid read this module needs)
// rather than the concrete Sim, so this sibling adds no import surface of its
// own; `Sim` satisfies it structurally once `gatheringGoalFor` is bound
// through the SimContext seam (src/sim/professions/gathering_goal_projection.ts).

import type { GatheringGoalView } from '../src/world_api/professions';

export interface GatheringGoalSelfReader {
  gatheringGoalFor(pid: number): GatheringGoalView | null;
}

export function appendGatheringGoalSelfWire(
  sim: GatheringGoalSelfReader,
  pid: number,
  maybe: (key: string, value: unknown) => void,
): void {
  maybe('ggoal', sim.gatheringGoalFor(pid));
}
