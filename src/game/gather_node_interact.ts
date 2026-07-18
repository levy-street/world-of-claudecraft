// Gather-node interaction (#1866): the pure decision for what happens when a
// player targets a Mining/Logging/Herbalism node. Click/tap-pick
// (renderer.pickGatherNode), the keyboard/gamepad Interact action, and the
// mobile Interact button all converge on this one core, mirroring the
// established pattern for entities (src/game/interactions.ts
// handlePickedEntity): DOM/Three-free so tests/gather_node_interact.test.ts
// drives it directly, main.ts is the thin consumer.
//
// Range mirrors the sim's authoritative INTERACT_RANGE gate in
// src/sim/professions/gathering.ts harvestNode. Readiness (`ready`) is per-VIEWER, from
// IWorldProfessions#nodeHarvestableByMe: the caller resolves it fresh, this
// core never caches it.

import { dist2d, INTERACT_RANGE } from '../sim/types';
import type { InteractionOutcome } from './interaction_autorun';

export type GatherNodeVerdict = 'too_far' | 'not_ready' | 'harvest';

export function decideGatherNodeAction(
  playerPos: { x: number; y: number; z: number },
  nodePos: { x: number; z: number },
  ready: boolean,
): GatherNodeVerdict {
  const d = dist2d(playerPos, { x: nodePos.x, y: playerPos.y, z: nodePos.z });
  if (d > INTERACT_RANGE) return 'too_far';
  if (!ready) return 'not_ready';
  return 'harvest';
}

export interface GatherNodeInteractWorld {
  nodeHarvestableByMe(nodeId: string): boolean;
  harvestNode(nodeId: string): InteractionOutcome;
}

export interface GatherNodeInteractHud {
  showError(text: string): void;
}

/** Thin dispatch: resolves the verdict, then either calls `harvestNode` and
 *  reports success or surfaces the matching localized error. The server remains authoritative
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
): InteractionOutcome {
  const verdict = decideGatherNodeAction(playerPos, nodePos, world.nodeHarvestableByMe(nodeId));
  if (verdict === 'too_far') {
    hud.showError(tooFarText);
    return false;
  }
  if (verdict === 'not_ready') {
    hud.showError(notReadyText);
    return false;
  }
  return world.harvestNode(nodeId);
}
