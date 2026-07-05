// Pure, host-agnostic core for the gathering HUD (issue 1124): per-viewer node
// ready/cooldown classification plus the gathering-proficiency display rows.
//
// DOM/Three-free so tests/gathering_view.test.ts can drive it directly. Two
// consumers read this core's output:
//   - minimap_markers.ts projects nearby node positions to canvas pixels and
//     asks classifyGatherNode for each one's ready/cooldown state (the
//     world-space indicator, see IWorldProfessions#nodeHarvestableByMe).
//   - char_window.ts renders buildGatheringProficiencyRows as the "Gathering"
//     section of the character sheet (the proficiency read surface, see
//     IWorldProfessions#professionsState).
//
// `nodeHarvestableByMe` is per-VIEWER (see src/world_api/professions.ts): two
// different IWorld-shaped inputs (one per player) asking about the SAME node
// id can and do return different states, because each player's respawn timer
// for a node is independent. This core never assumes otherwise: it always
// re-resolves through the passed-in `world`, never caches across callers.

import { GATHERING_PROFESSION_IDS, type GatheringProfessionId } from '../sim/content/professions';
import { GATHER_NODES } from '../sim/data';
import type { GatherNodeDef } from '../sim/types';
import type { IWorld } from '../world_api';

/** Whether a gather node is harvestable right now for the local viewer, or on
 *  cooldown for them specifically (another player may see the opposite state
 *  for the same node id). */
export type GatherNodeState = 'ready' | 'cooldown';

/** Resolves one node's per-viewer state via IWorldProfessions#nodeHarvestableByMe. */
export function classifyGatherNode(world: IWorld, nodeId: string): GatherNodeState {
  return world.nodeHarvestableByMe(nodeId) ? 'ready' : 'cooldown';
}

/** One nearby gather node, classified for the local viewer. */
export interface NearbyGatherNode {
  id: string;
  type: GatherNodeDef['type'];
  x: number;
  z: number;
  state: GatherNodeState;
}

/** All GATHER_NODES within `radiusYd` of the viewer's current position,
 *  classified ready/cooldown for that viewer. Flat 2D distance (node
 *  placements carry no y, matching sim/professions/gathering.ts). */
export function buildNearbyGatherNodes(world: IWorld, radiusYd: number): NearbyGatherNode[] {
  const p = world.player;
  const out: NearbyGatherNode[] = [];
  for (const node of GATHER_NODES) {
    const dx = node.pos.x - p.pos.x;
    const dz = node.pos.z - p.pos.z;
    if (Math.sqrt(dx * dx + dz * dz) > radiusYd) continue;
    out.push({
      id: node.id,
      type: node.type,
      x: node.pos.x,
      z: node.pos.z,
      state: classifyGatherNode(world, node.id),
    });
  }
  return out;
}

/** One row of the gathering-proficiency display: a profession id plus its
 *  current point value, in the fixed GATHERING_PROFESSION_IDS order. */
export interface GatheringProficiencyRow {
  professionId: GatheringProfessionId;
  value: number;
}

/** Builds the proficiency display rows from IWorldProfessions#professionsState,
 *  in the fixed profession order, defaulting an absent/malformed entry to 0. */
export function buildGatheringProficiencyRows(world: IWorld): GatheringProficiencyRow[] {
  const bySkill = new Map(world.professionsState.skills.map((s) => [s.professionId, s.skill]));
  return GATHERING_PROFESSION_IDS.map((professionId) => {
    const raw = bySkill.get(professionId);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return { professionId, value };
  });
}
