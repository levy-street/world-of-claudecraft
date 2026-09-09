// Corpse-harvest SCOPE (Intentional Gathering, PR3): is this actor standing in
// the SAME owned world/instance as this corpse? Membership/registration and
// physical location are both required and neither substitutes for the other
// (a teleported stranger can share a position with no membership; a departed
// member can keep membership with no position):
// - Dungeon/raid: the corpse's claim (`claimedInstanceForMob`) must be the SAME
//   live InstanceSlot OBJECT both the corpse and the actor physically stand in
//   (`instanceAt` on each position; two slots can share a `partyKey` string
//   after a reset/collision, so identity is never a string compare), AND the
//   actor's own `instanceKeyFor` must match the claim's `partyKey`.
// - Rift: the corpse's mob must be registered in the instance's own `mobIds`
//   roster AND the actor must both be a `memberIds` member and be PHYSICALLY
//   on that instance's floor right now (`riftInstanceAtPos` on the actor's
//   live position).
// - Delve: the corpse's run (`delveRunForMob`, a roster lookup with no
//   position check of its own) must equal a COLD (non-mutating) read of the
//   actor's own run, AND the corpse's own position must itself lie inside
//   that run's occupancy band. The cold read never uses the real
//   `delveRunForPlayer`, which can rebind a run to a new occupant as a side
//   effect a scope CHECK must never trigger.
// - No live claim anywhere: a corpse or an actor inside the instance plane
//   (`DUNGEON_X_THRESHOLD` east, the same backstop vault_craft_gate.ts uses)
//   is an orphan on EITHER side and never resolves to open-world content.
// - Every position comparison (band checks and the instance-plane checks
//   alike) rejects a non-finite coordinate: comparisons are written as the
//   negation of the true sense (e.g. `!(x <= n)`) rather than a bare `>`,
//   since `NaN > n` and `NaN <= n` are both false and would otherwise admit a
//   corrupt position. A non-finite actor or corpse position (any axis) is
//   also rejected outright before any branch below runs.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). Draws no rng, mutates
// nothing.

import { DUNGEON_X_THRESHOLD, isRiftPos } from '../data';
import { delveOccupancyRadius } from '../delves/runs';
import { claimedInstanceForMob, instanceAt, instanceKeyFor } from '../instances/dungeons';
import { riftInstanceAtPos } from '../rift/runs';
import type { SimContext } from '../sim_context';
import type { DelveRun, Entity, Vec3 } from '../types';

function isFinitePos(pos: Vec3): boolean {
  return Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
}

/** Cold, finite-safe band check: is `pos` inside `run`'s own occupancy band?
 *  Every comparison is the negation of the true (band-membership) sense, so a
 *  non-finite coordinate can never slip through (see the file banner). Shared
 *  by the player-only cold view below AND `sameHarvestScope`'s own check on
 *  the CORPSE's position, so a claimed run's corpse is held to the identical
 *  band a live occupant would be. */
function insideDelveRunColdBand(pos: Vec3, run: DelveRun): boolean {
  if (!(Math.abs(pos.x - run.origin.x) <= 120)) return false;
  if (!(Math.abs(pos.z - run.origin.z) <= delveOccupancyRadius(run))) return false;
  return true;
}

/** The KEY-matched half of `delves/runs.ts` `delveRunForPlayer`, with its
 *  cross-key `rebindDelveRunToOccupant` fallback removed: a legitimate
 *  rejoin (same instance key, inside the run's own band) still resolves, but
 *  an unrelated occupant is never bound into someone else's run just for
 *  answering a scope question. */
function delveRunForPlayerColdView(ctx: SimContext, pid: number) {
  const e = ctx.entities.get(pid);
  if (!e) return null;
  const key = ctx.instanceKeyFor(pid);
  for (const run of ctx.delveRuns) {
    if (run.partyKey !== key) continue;
    if (!insideDelveRunColdBand(e.pos, run)) continue;
    return run;
  }
  return null;
}

export function sameHarvestScope(ctx: SimContext, actorEntityId: number, corpse: Entity): boolean {
  const actor = ctx.entities.get(actorEntityId);
  if (!actor) return false;
  if (!isFinitePos(actor.pos) || !isFinitePos(corpse.pos)) return false;

  const dungeonClaim = claimedInstanceForMob(ctx, corpse.id);
  if (dungeonClaim) {
    return (
      instanceAt(ctx, corpse.pos) === dungeonClaim &&
      instanceAt(ctx, actor.pos) === dungeonClaim &&
      instanceKeyFor(ctx, actorEntityId) === dungeonClaim.partyKey
    );
  }

  const corpseRift = isRiftPos(corpse.pos.x) ? riftInstanceAtPos(ctx, corpse.pos) : null;
  if (corpseRift) {
    return (
      corpseRift.mobIds.includes(corpse.id) &&
      corpseRift.memberIds.has(actorEntityId) &&
      riftInstanceAtPos(ctx, actor.pos) === corpseRift
    );
  }

  const corpseDelve = ctx.delveRunForMob(corpse.id);
  if (corpseDelve) {
    return (
      insideDelveRunColdBand(corpse.pos, corpseDelve) &&
      delveRunForPlayerColdView(ctx, actorEntityId) === corpseDelve
    );
  }

  // No live claim anywhere: a corpse OR an actor still inside the instance
  // plane is an orphan on that side, never open-world content.
  if (corpse.pos.x > DUNGEON_X_THRESHOLD || actor.pos.x > DUNGEON_X_THRESHOLD) return false;

  // Genuinely open-world: the actor must not themselves be mid-instance.
  if (instanceAt(ctx, actor.pos) !== null) return false;
  if (isRiftPos(actor.pos.x) && riftInstanceAtPos(ctx, actor.pos) !== null) return false;
  if (delveRunForPlayerColdView(ctx, actorEntityId) !== null) return false;
  return true;
}
