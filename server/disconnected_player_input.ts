import type { Sim } from '../src/sim/sim';
import { emptyMoveInput } from '../src/sim/types';
import { leaveWispMaze } from '../src/sim/world_quest_wisp_maze';

/** A dropped socket drops carried freight, releases a manned cannon, and cannot keep
 *  steering or lose maze lives while disconnected. */
export function stopDisconnectedPlayerInput(sim: Sim, pid: number): void {
  sim.dropWorldQuestDeliveryCargo(pid);
  sim.leaveVehicle(pid);
  const meta = sim.meta(pid);
  if (!meta) return;
  Object.assign(meta.moveInput, emptyMoveInput());
  const player = sim.entities.get(pid);
  if (player) leaveWispMaze(sim.ctx, meta, player);
}
