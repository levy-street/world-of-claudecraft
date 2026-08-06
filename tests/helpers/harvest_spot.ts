// Shared node-placement helper for harvest tests: teleports a player onto a
// node's exact (x, z) so the distance check always passes, EXCEPT when that
// spot is swim-deep water. Waterline nodes (herb_eastbrook_1 sits in the vale
// lake) are harvested WADING beside the node, the way a real player must since
// the swimming denial landed on harvestNode: for a swim-deep node center this
// walks a deterministic ring inside INTERACT_RANGE for the nearest standable
// point. Draw-free and content-driven, so fixtures never hand-pick magic
// coordinates per node.
import { GATHER_NODES } from '../../src/sim/content/gather_nodes';
import { PLAYER_SWIM_DEPTH } from '../../src/sim/pathfind';
import type { Sim } from '../../src/sim/sim';
import { groundHeight, terrainHeight, waterLevelAt } from '../../src/sim/world';

export function placeAtHarvestSpot(sim: Sim, pid: number, nodeId: string): void {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing entity ${pid}`);
  const seed = sim.cfg.seed;
  const swimDeep = (x: number, z: number) =>
    groundHeight(x, z, seed) < waterLevelAt(x, z, seed) - PLAYER_SWIM_DEPTH;
  let spot = { x: node.pos.x, z: node.pos.z };
  if (swimDeep(spot.x, spot.z)) {
    outer: for (let d = 0.5; d <= 4.5; d += 0.5) {
      for (let a = 0; a < 16; a++) {
        const x = node.pos.x + Math.cos((a * Math.PI) / 8) * d;
        const z = node.pos.z + Math.sin((a * Math.PI) / 8) * d;
        if (!swimDeep(x, z)) {
          spot = { x, z };
          break outer;
        }
      }
    }
  }
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = terrainHeight(spot.x, spot.z, seed);
  p.prevPos = { ...p.pos };
}
