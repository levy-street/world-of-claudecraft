// Server-side moderation moves (jail, the release, the moderator jail visit, the
// cage gate) and the rift floor they may leave or land on.
//
// These moves bypass the sim's own teleports, and ClientWorld mirrors its rift
// floor from riftState events alone (src/net/online.ts applyRiftStateEvent), while
// the online world map and minimap both lead with that floor. So a move off a rift
// floor sends the exit the rift's own exit would (rift/runs.ts detachFromRift), and
// a move that lands on a live floor the player still belongs to re-describes it
// (riftStateEventFor, the resumeSession pattern). Without them a prisoner kept the
// rift plan in the cage, and a moderator back from a visit lost the floor (and its
// predicted collision). Both legs ride the sim event queue, so they reach the client
// in order with whatever the move itself emitted.
import { cancelProfessionSessionOnDisplacement } from '../src/sim/professions/session_teardown';
import {
  detachFromRift,
  type RiftStateEvent,
  riftInstanceAtPos,
  riftStateEventFor,
} from '../src/sim/rift/runs';
import type { Sim } from '../src/sim/sim';
import { type Entity, emptyMoveInput, type Vec3 } from '../src/sim/types';

/** The outside spot a rift run sends its members back to (its portal side). */
export interface RiftExitSpot {
  x: number;
  z: number;
  facing: number;
}

/** The exit spot of the live rift floor at `pos`, or null off every rift floor. Read-only. */
export function riftExitSpotAt(sim: Sim, pos: Vec3): RiftExitSpot | null {
  const inst = riftInstanceAtPos(sim.ctx, pos);
  return inst ? { x: inst.returnPos.x, z: inst.returnPos.z, facing: inst.returnFacing ?? 0 } : null;
}

/** Where a jail sentence returns `e` to. A rift floor returns to the run's exit
 *  spot instead: a sentence routinely outlasts the run's empty timeout, after
 *  which the floor is freed and the saved spot is empty rift band. */
export function jailReturnPoint(
  sim: Sim,
  e: Entity,
): { returnPos: { x: number; z: number }; returnFacing: number } {
  const exit = riftExitSpotAt(sim, e.pos);
  if (exit) return { returnPos: { x: exit.x, z: exit.z }, returnFacing: exit.facing };
  return { returnPos: { x: e.pos.x, z: e.pos.z }, returnFacing: e.facing };
}

/** Detach `pid` from the rift floor they stand on ahead of a moderation move (the
 *  exit event, a lockpick abort, the slide pose). A no-op off every rift floor.
 *  `deliver` replaces the sim queue for a moderator entering spectate: the event
 *  router drops a spectator's own non-chat events, so a queued exit never arrives. */
export function leaveRiftForModeration(
  sim: Sim,
  pid: number,
  deliver?: (ev: RiftStateEvent) => void,
): void {
  const e = sim.entities.get(pid);
  if (e) detachFromRift(sim.ctx, e, deliver);
}

/** After a moderation move lands `pid`, re-describe the live rift floor they are
 *  back on, when they are still one of its members. A no-op anywhere else. */
export function rejoinRiftAfterModeration(sim: Sim, pid: number): void {
  const ev = riftStateEventFor(sim.ctx, pid);
  if (ev) sim.ctx.emit(ev);
}

/** Hand `pid`'s live rift floor straight to a socket through `deliver`, as an
 *  events frame, for a client whose mirror does not hold it. A no-op off every
 *  member floor. A resumed session gets its own floor; a spectate open or
 *  retarget gets the target's, and a spectate exit the moderator's own, each
 *  straight after the spectate frame: the client resets its mirror on every
 *  spectate frame (src/net/rift_floor_mirror.ts) and the event router forwards
 *  only the target's floor transitions, so a view opened on a runner already
 *  inside a rift would otherwise show the overworld map. */
export function describeRiftFloor(
  sim: Sim,
  pid: number,
  deliver: (frame: { t: 'events'; list: RiftStateEvent[] }) => void,
): void {
  const ev = riftStateEventFor(sim.ctx, pid);
  if (ev) deliver({ t: 'events', list: [ev] });
}

/** Where a moderator's return leg lands: the saved spot, unless it is a rift floor
 *  `pid` no longer belongs to (the run emptied and was freed, or the slot reused,
 *  while they were away), in which case the run's exit spot recorded on the way out. */
export function moderationReturnSpot(
  sim: Sim,
  pid: number,
  saved: Vec3,
  riftExit: RiftExitSpot | null | undefined,
): Vec3 {
  if (!riftExit || riftInstanceAtPos(sim.ctx, saved)?.memberIds.has(pid)) return saved;
  return sim.groundPos(riftExit.x, riftExit.z);
}

/** Move a session's entity for a moderation action. With `revive`, a dead or ghost
 *  entity is revived at the spot (grounded unless `pos` carries its own y); anyone
 *  else is teleported there with the shared displacement teardown, since these moves
 *  bypass the sim's own teleport paths. The rift legs above wrap the move. */
export function teleportForModeration(
  sim: Sim,
  pid: number,
  pos: { x: number; y?: number; z: number },
  revive = false,
): void {
  const entity = sim.entities.get(pid);
  if (!entity) return;
  leaveRiftForModeration(sim, pid);
  if (revive && (entity.dead || entity.ghost)) {
    const at = pos.y === undefined ? sim.groundPos(pos.x, pos.z) : { x: pos.x, y: pos.y, z: pos.z };
    sim.revivePlayerAt(pid, at, 1);
  } else {
    cancelProfessionSessionOnDisplacement(sim.ctx, entity);
    const ground = sim.groundPos(pos.x, pos.z);
    entity.pos = ground;
    entity.prevPos = { ...ground };
    entity.vy = 0;
    entity.onGround = true;
    entity.fallStartY = ground.y;
    sim.grid.update(entity);
    sim.playerGrid.update(entity);
    const meta = sim.meta(pid);
    if (meta) Object.assign(meta.moveInput, emptyMoveInput());
  }
  rejoinRiftAfterModeration(sim, pid);
}
