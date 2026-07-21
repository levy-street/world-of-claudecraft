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

import { canGatherTier } from '../sim/professions/tools';
import { dist2d, INTERACT_RANGE } from '../sim/types';
import type { InteractionOutcome } from './interaction_autorun';

export type GatherNodeVerdict = 'too_far' | 'tool_tier' | 'not_ready' | 'harvest';

/** The tool-tier access gate for one node (Professions 2.0 Phase 12): the
 *  node's content tier plus the viewer's owned-best matching tool tier (the
 *  bare-hands floor is tier 1), with the localized denial line the caller
 *  resolved for exactly this node (tier + profession baked in). Optional so
 *  the pure decision stays callable tier-agnostically, but BOTH live call
 *  sites (main.ts click path, nearby_interaction.ts) always pass it; the
 *  required tier of a 'tool_tier' verdict is the toolGate.nodeTier the caller
 *  already holds. */
export interface GatherNodeToolGate {
  nodeTier: number;
  viewerToolTier: number;
  unmetText: string;
}

export function decideGatherNodeAction(
  playerPos: { x: number; y: number; z: number },
  nodePos: { x: number; z: number },
  ready: boolean,
  toolGate?: Pick<GatherNodeToolGate, 'nodeTier' | 'viewerToolTier'>,
): GatherNodeVerdict {
  const d = dist2d(playerPos, { x: nodePos.x, y: playerPos.y, z: nodePos.z });
  if (d > INTERACT_RANGE) return 'too_far';
  // Deliberate divergence from the sim's authoritative order: harvestNode
  // checks respawn readiness BEFORE the tool gate (a cooling node never emits
  // gatherDenied; pinned in tests/gather_node_harvest.test.ts), while this
  // pre-gate reports the lock first so a locked node reads as locked, not as
  // "not respawned" (the tool shortfall is the durable, actionable fact; the
  // client-order pin lives in tests/gather_node_interact.test.ts). The shared
  // canGatherTier comparator decides both layers.
  if (toolGate && !canGatherTier(toolGate.viewerToolTier, toolGate.nodeTier)) return 'tool_tier';
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
  toolGate?: GatherNodeToolGate,
): InteractionOutcome {
  const verdict = decideGatherNodeAction(
    playerPos,
    nodePos,
    world.nodeHarvestableByMe(nodeId),
    toolGate,
  );
  if (verdict === 'too_far') {
    hud.showError(tooFarText);
    return false;
  }
  if (verdict === 'tool_tier') {
    // Only reachable with a toolGate (decideGatherNodeAction never returns it
    // otherwise); the sim/server re-validates and would answer gatherDenied,
    // so this stays the established don't-bother-sending pre-gate.
    if (toolGate) hud.showError(toolGate.unmetText);
    return false;
  }
  if (verdict === 'not_ready') {
    hud.showError(notReadyText);
    return false;
  }
  return world.harvestNode(nodeId);
}
