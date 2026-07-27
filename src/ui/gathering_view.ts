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
import { GATHER_NODES, ITEMS } from '../sim/data';
import { NODE_HARVEST_TABLE } from '../sim/professions/gathering';
import { bestOwnedGatherToolTierOrNone, canGatherTier } from '../sim/professions/tools';
import type { GatherNodeDef } from '../sim/types';
import type { IWorld } from '../world_api';
import type { TranslationKey } from './i18n.catalog';

/** Whether a gather node is harvestable right now for the local viewer, or on
 *  cooldown for them specifically (another player may see the opposite state
 *  for the same node id). */
export type GatherNodeState = 'ready' | 'cooldown';

/** Resolves one node's per-viewer state via IWorldProfessions#nodeHarvestableByMe. */
export function classifyGatherNode(world: IWorld, nodeId: string): GatherNodeState {
  return world.nodeHarvestableByMe(nodeId) ? 'ready' : 'cooldown';
}

/** The viewer's best owned gatherTool tier for one gathering profession
 *  (Professions 2.0), resolved from the same IWorld bags read the
 *  bags window renders (IWorldInventory#inventory). 0 means no matching tool
 *  owned at all (#2343: bare hands never gather, so there is no floor here
 *  and every node, tier 1 included, reads locked without its tool). */
export function viewerOwnedToolTier(world: IWorld, professionId: GatheringProfessionId): number {
  return bestOwnedGatherToolTierOrNone(world.inventory, professionId, ITEMS);
}

/** Whether a node of this tier is tool-locked for the viewer: a SEPARATE
 *  dimension from ready/cooldown (respawn state), so the minimap can compose
 *  both. Uses the sim's own canGatherTier comparator, never a local copy. */
export function isNodeToolLockedFor(
  world: IWorld,
  node: Pick<GatherNodeDef, 'type' | 'tier'>,
): boolean {
  return !canGatherTier(
    viewerOwnedToolTier(world, NODE_HARVEST_TABLE[node.type].professionId),
    node.tier,
  );
}

/** One nearby gather node, classified for the local viewer. `locked` is the
 *  tool-tier access dimension; `state` stays the respawn dimension. */
export interface NearbyGatherNode {
  id: string;
  type: GatherNodeDef['type'];
  x: number;
  z: number;
  state: GatherNodeState;
  tier: number;
  locked: boolean;
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
      tier: node.tier,
      locked: isNodeToolLockedFor(world, node),
    });
  }
  return out;
}

/** Everything the gather-node hover tooltip renders, resolved for
 *  the local viewer: name by node family, the access-tier requirement, whether
 *  the viewer's owned-best tool meets it, and the respawn state. Null for an
 *  unknown node id (a stale pick after a content change). */
export interface GatherNodeTooltipModel {
  type: GatherNodeDef['type'];
  professionId: GatheringProfessionId;
  tier: number;
  locked: boolean;
  state: GatherNodeState;
}

export function buildGatherNodeTooltip(
  world: IWorld,
  nodeId: string,
): GatherNodeTooltipModel | null {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) return null;
  return {
    type: node.type,
    professionId: NODE_HARVEST_TABLE[node.type].professionId,
    tier: node.tier,
    locked: isNodeToolLockedFor(world, node),
    state: classifyGatherNode(world, node.id),
  };
}

/** The i18n key the gatherDenied SimEvent's error toast resolves (the sim is
 *  text-free: the client composes its own copy off surface + professionId +
 *  requiredTier). Surface 'fishing' is the startFishing implement gate
 *  (#2343); surface 'node' with requiredTier 1 means "no tool owned at all"
 *  so the tierless line is used; anything unexpected falls back to the
 *  profession-neutral corpse line. */
export function gatherDeniedLineKey(
  surface: 'node' | 'corpse' | 'fishing',
  professionId?: GatheringProfessionId,
  requiredTier?: number,
): TranslationKey {
  if (surface === 'fishing') return 'hudChrome.gathering.toolRequired.fishing';
  if (surface === 'node') {
    if (professionId === 'mining' || professionId === 'logging' || professionId === 'herbalism') {
      return requiredTier !== undefined && requiredTier <= 1
        ? `hudChrome.gathering.toolRequired.${professionId}`
        : `hudChrome.gathering.toolTierUnmet.${professionId}`;
    }
  }
  return 'hudChrome.gathering.toolTierUnmetCorpse';
}

/** The i18n key the gatherToolNoNode SimEvent's error toast resolves (#2343:
 *  a gathering tool was used from the bags with no matching node within
 *  reach). Fishing never emits it (rods route to startFishing), so anything
 *  but the three node professions takes a safe fallback. */
export function gatherToolNoNodeKey(professionId: GatheringProfessionId): TranslationKey {
  if (professionId === 'logging' || professionId === 'herbalism') {
    return `hudChrome.gathering.noNodeNearby.${professionId}`;
  }
  return 'hudChrome.gathering.noNodeNearby.mining';
}

/** The i18n key the gatherDowngrade SimEvent's toast resolves (the
 *  sim is text-free): 'mark' means the yield arrived as a plain unsigned
 *  top-up, 'find' means a pure-extra specimen jackpot was dropped outright. */
export function gatherDowngradeLineKey(lost: 'mark' | 'find'): TranslationKey {
  return lost === 'find'
    ? 'hudChrome.gathering.downgradeFind'
    : 'hudChrome.gathering.downgradeMark';
}

/** Which layered rarity stinger (if any) a gather's loot event should play on
 *  top of the node-type impact cue. A rare event forces at least the epic
 *  stinger regardless of the rolled material rarity (a rare event is rarer
 *  than a legendary material roll at every proficiency level:
 *  GATHER_RARE_EVENT_CHANCE is a flat 1/90 draw, gather_events.ts); otherwise
 *  the stinger tracks the rolled tier 1:1. common/uncommon get no stinger. */
export function gatherRareTierFor(
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
  rareEvent: unknown,
): 'rare' | 'epic' | 'legendary' | null {
  if (rarity === 'legendary') return 'legendary';
  if (rarity === 'epic' || rareEvent !== null) return 'epic';
  if (rarity === 'rare') return 'rare';
  return null;
}

/** One row of the gathering-proficiency display: a profession id plus its
 *  current point value, in the fixed GATHERING_PROFESSION_IDS order. `value`
 *  is the raw, possibly fractional proficiency (the repaint-signature input,
 *  full granularity); `displayValue` floors it for readouts, the
 *  buildSkillBar convention (issue 2339): a fractional value never rounds a
 *  threshold forward, so 99.5 reads 99, not a fake crossed 100 while the
 *  100-proficiency deed is still locked. */
export interface GatheringProficiencyRow {
  professionId: GatheringProfessionId;
  value: number;
  displayValue: number;
}

/** Builds the proficiency display rows from IWorldProfessions#professionsState,
 *  in the fixed profession order, defaulting an absent/malformed entry to 0. */
export function buildGatheringProficiencyRows(world: IWorld): GatheringProficiencyRow[] {
  const bySkill = new Map(world.professionsState.skills.map((s) => [s.professionId, s.skill]));
  return GATHERING_PROFESSION_IDS.map((professionId) => {
    const raw = bySkill.get(professionId);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return { professionId, value, displayValue: Math.floor(value) };
  });
}
