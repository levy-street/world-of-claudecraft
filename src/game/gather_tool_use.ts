// Client-side gathering-tool item use (#2343): clicking a pick/axe/sickle in
// the bags (or pressing it on the hotbar) behaves like the interact press,
// scoped to the tool's own profession. These pure helpers pick the node; the
// main.ts hook composes them with handleGatherNodeInteract (the localized
// error surface + world.harvestNode dispatch) wrapped in
// stopAutorunForInteraction, so the bag click honors the #1982 autorun-stop
// contract exactly like the F key and the node click. Fishing tools never
// resolve here (their item use routes to startFishing at the sim boundary),
// and the server stays authoritative: whichever node the client picks is
// re-validated by the sim's own harvestNode gates.

import type { GatheringProfessionId } from '../sim/content/professions';
import { GATHER_NODES } from '../sim/data';
import { NODE_TYPE_BY_PROFESSION } from '../sim/professions/gathering';
import { isGatherToolUse } from '../sim/professions/tools';
import { type GatherNodeDef, INTERACT_RANGE, type ItemDef } from '../sim/types';
import type { IWorld } from '../world_api';

/** The node profession a bag-clicked tool gathers for, or null when the item
 *  is not a node-gathering tool (non-tools and fishing implements fall back
 *  to the plain useItem path). */
export function gatherToolProfessionFor(item: ItemDef): GatheringProfessionId | null {
  const use = item.use;
  if (!isGatherToolUse(use)) return null;
  return use.professionId in NODE_TYPE_BY_PROFESSION ? use.professionId : null;
}

/** The node a tool click should work: the nearest matching-type node within
 *  interact range, preferring one that is ready for this viewer over one
 *  still respawning (ties resolve by distance). Mirrors the sim-side
 *  useGatherToolItem selection policy; the sim re-validates whichever id is
 *  sent, so the mirror is a UX nicety, never an authority. */
export function nearestGatherNodeForProfession(
  world: Pick<IWorld, 'player' | 'nodeHarvestableByMe'>,
  professionId: GatheringProfessionId,
): GatherNodeDef | null {
  const nodeType = NODE_TYPE_BY_PROFESSION[professionId];
  if (!nodeType) return null;
  const p = world.player;
  let best: GatherNodeDef | null = null;
  let bestDist = Infinity;
  let bestReady = false;
  for (const node of GATHER_NODES) {
    if (node.type !== nodeType) continue;
    const dx = p.pos.x - node.pos.x;
    const dz = p.pos.z - node.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > INTERACT_RANGE) continue;
    const ready = world.nodeHarvestableByMe(node.id);
    if (ready !== bestReady) {
      if (!ready) continue;
      best = node;
      bestDist = d;
      bestReady = true;
    } else if (d < bestDist) {
      best = node;
      bestDist = d;
    }
  }
  return best;
}
