// Gather-node interaction (#1866): the pure decision for what happens when a
// player targets a Mining/Logging/Herbalism node. Click/tap-pick
// (renderer.pickGatherNode), the keyboard/gamepad Interact action, and the
// mobile Interact button all converge on this one core, mirroring the
// established pattern for entities (src/game/interactions.ts
// handlePickedEntity): DOM/Three-free so tests/gather_node_interact.test.ts
// drives it directly, main.ts is the thin consumer.
//
// Range mirrors the object/corpse interact tolerance in interactions.ts
// (INTERACT_RANGE + 1, a touch past the sim's own INTERACT_RANGE gate in
// src/sim/professions/gathering.ts harvestNode, so a legitimate click at the
// edge of range is not flagged too-far by the client a tick before the
// player's position update lands). Readiness (`ready`) is per-VIEWER, from
// IWorldProfessions#nodeHarvestableByMe: the caller resolves it fresh, this
// core never caches it.

import { dist2d, INTERACT_RANGE } from '../sim/types';

export type GatherNodeVerdict = 'too_far' | 'not_ready' | 'harvest';

export function decideGatherNodeAction(
  playerPos: { x: number; y: number; z: number },
  nodePos: { x: number; z: number },
  ready: boolean,
): GatherNodeVerdict {
  const d = dist2d(playerPos, { x: nodePos.x, y: playerPos.y, z: nodePos.z });
  if (d > INTERACT_RANGE + 1) return 'too_far';
  if (!ready) return 'not_ready';
  return 'harvest';
}

export interface GatherNodeInteractWorld {
  nodeHarvestableByMe(nodeId: string): boolean;
  harvestNode(nodeId: string): void;
}

export interface GatherNodeInteractHud {
  showError(text: string): void;
}

/** Thin dispatch: resolves the verdict, then either calls `harvestNode` or
 *  surfaces the matching localized error. The server remains authoritative
 *  (a stale client-side `ready` read still gets rejected server-side); this
 *  is purely a client-side "don't bother sending the command" / feedback gate. */
export function handleGatherNodeInteract(
  world: GatherNodeInteractWorld,
  hud: GatherNodeInteractHud,
  playerPos: { x: number; y: number; z: number },
  nodeId: string,
  nodePos: { x: number; z: number },
  tooFarText: string,
  notReadyText: string,
): void {
  const verdict = decideGatherNodeAction(playerPos, nodePos, world.nodeHarvestableByMe(nodeId));
  if (verdict === 'too_far') {
    hud.showError(tooFarText);
    return;
  }
  if (verdict === 'not_ready') {
    hud.showError(notReadyText);
    return;
  }
  world.harvestNode(nodeId);
}
