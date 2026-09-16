// The interact key's gather-node inputs. Two things main.ts used to build
// inline: the R40 per-use effect confirm gate every gather entry point shares
// (world click, interact key, gathering-tool use), and the node bundle the
// generic nearby press (src/game/nearby_interaction.ts tryNearbyInteraction)
// takes for its gather-node arm. Both are thin wiring over existing cores:
// the pure question from the gathering view, the ask through the HUD's
// confirm-dialog family, the tool gate from the node tooltip controller.
// main.ts is a firewall, not a home (tests/monolith_budget.test.ts), so the
// wiring lives here where tests/interact_key_gather.test.ts can drive it.

import { GATHER_NODES } from '../sim/data';
import { gatherNodeToolGateFor } from '../ui/gather_node_tooltip_controller';
import { gatherEffectPrompt } from '../ui/hud/professions/gathering_view';
import { t } from '../ui/i18n';
import type { IWorld } from '../world_api';
import type { GatherEffectConfirmGate } from './gather_node_interact';
import type { NearbyGatherOptions } from './nearby_interaction';

/** The one HUD member the confirm gate needs (hud.ts satisfies it
 *  structurally). */
export interface GatherEffectConfirmHud {
  confirmToolEffectUse(
    prompt: { effectId: string; charges: number },
    proceed: (confirmed: boolean) => void,
  ): void;
}

/** The R40 per-use effect confirm gate: the harvest proceeds on either
 *  answer; only the charge follows it. */
export function createGatherEffectConfirm(
  world: IWorld,
  hud: GatherEffectConfirmHud,
): GatherEffectConfirmGate {
  return {
    needed: (nodeId) => gatherEffectPrompt(world, nodeId),
    ask: (prompt, proceed) => hud.confirmToolEffectUse(prompt, proceed),
  };
}

/** The gather-node arm's inputs for the interact key: the live node list,
 *  the tool-tier gate resolved against the picked node, the localized
 *  too-far / not-ready lines, and the shared confirm gate. The key thereby
 *  harvests the nearest node in reach through the same core as the node
 *  click and the gathering-tool press, so the three cannot drift. */
export function interactKeyGatherOptions(
  world: IWorld,
  effectConfirm: GatherEffectConfirmGate,
): NearbyGatherOptions {
  return {
    nodes: GATHER_NODES,
    toolGateFor: (node) => gatherNodeToolGateFor(world, node),
    tooFarText: t('questUi.errors.tooFar'),
    notReadyText: t('hudChrome.gathering.notReady'),
    effectConfirm,
  };
}
