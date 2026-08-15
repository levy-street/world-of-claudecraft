// Pure, host-agnostic core for the gathering HUD (issue 1124): per-viewer node
// ready/cooldown classification plus the gathering-proficiency display rows.
//
// DOM/Three-free so tests/gathering_view.test.ts can drive it directly. Three
// consumers read this core's output:
//   - minimap_markers.ts projects nearby node positions to canvas pixels and
//     asks classifyGatherNode for each one's ready/cooldown state (the
//     world-space indicator, see IWorldProfessions#nodeHarvestableByMe).
//   - map_window_view.ts projects every in-zone node for the zone map, sharing
//     viewerUsableToolTier so the map and minimap lock dimension agree.
//   - char_window.ts renders buildGatheringProficiencyRows as the "Gathering"
//     section of the character sheet (the proficiency read surface, see
//     IWorldProfessions#professionsState).
//
// `nodeHarvestableByMe` is per-VIEWER (see src/world_api/professions.ts): two
// different IWorld-shaped inputs (one per player) asking about the SAME node
// id can and do return different states, because each player's respawn timer
// for a node is independent. This core never assumes otherwise: it always
// re-resolves through the passed-in `world`, never caches across callers.

import { bagCapacity, countFit } from '../sim/bags';
import { isActionLockingFormAuraKind } from '../sim/combat/forms';
import {
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  type GatheringProfessionId,
  TOOL_EFFECTS,
  type ToolEffectId,
} from '../sim/content/professions';
import { GATHER_NODES, ITEMS } from '../sim/data';
import {
  effectiveGradeToolTier,
  type GradeReadMeta,
  harvestYieldItemIdFor,
  NODE_HARVEST_TABLE,
  nodeMaterialFor,
  usableToolEffectSlot,
} from '../sim/professions/gathering';
import { applyToolEffectUse, canGatherTier, type ToolEffectSlot } from '../sim/professions/tools';
import {
  bestWieldableGatherToolTierOrNone,
  minWieldRequirementToWork,
} from '../sim/professions/wield_gate';
import { type GatherNodeDef, isConsuming } from '../sim/types';
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

/** The viewer's best USABLE gatherTool tier for one gathering profession:
 *  the same IWorld bags read the bags window renders
 *  (IWorldInventory#inventory), filtered by the R22 wield gate against the
 *  viewer's own counter (the plain `gatheringProficiency` map both worlds
 *  expose and the vendor advisory already reads: the Sim getter copies the
 *  live map, ClientWorld mirrors the gprof wire field). Guarded end to end:
 *  a partial IWorld stub or a malformed mirror reads undefined here, and
 *  bestWieldableGatherToolTierOrNone coerces absent-or-malformed to 0,
 *  which LOCKS (the documented fail-closed contract; a thrown read one
 *  level above the coercion would defeat it). 0 means nothing usable at
 *  all (#2343: bare hands never gather, so every node, tier 1 included,
 *  reads locked without a usable tool). This is the ONE client-side scan:
 *  the minimap lock, the node tooltip, and the interact pre-verdict all
 *  read it, so what the client shows can never disagree with what the
 *  sim's wield-filtered harvest gate refuses. Fishing passes through
 *  unfiltered inside the shared resolver (rods are R22-exempt). */
export function viewerUsableToolTier(
  world: IWorld,
  professionId: GatheringProfessionId,
  // A caller resolving several professions in one pass (the minimap's
  // 10 Hz marker build) hands the map it already read: the offline world's
  // gatheringProficiency getter COPIES the live map per access, so
  // re-reading it per profession is per-build garbage the reference probe
  // cannot see. Single-callers omit it and read through as before. The
  // pairing is on the caller: hand the map from THE SAME world as the bags,
  // read within the same synchronous pass (nothing guards a cross-world or
  // held-over map).
  proficiency: Readonly<Record<string, number>> | undefined = world.gatheringProficiency,
): number {
  const skill = proficiency?.[professionId];
  return bestWieldableGatherToolTierOrNone(world.inventory, professionId, skill, ITEMS);
}

/** Whether a node of this tier is tool-locked for the viewer: a SEPARATE
 *  dimension from ready/cooldown (respawn state), so the minimap can compose
 *  both. Uses the sim's own canGatherTier comparator, never a local copy. */
export function isNodeToolLockedFor(
  world: IWorld,
  node: Pick<GatherNodeDef, 'type' | 'tier'>,
): boolean {
  return !canGatherTier(
    viewerUsableToolTier(world, NODE_HARVEST_TABLE[node.type].professionId),
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
 *  the viewer's best USABLE tool meets it (owned-but-unearned locks, R22),
 *  the wield shortfall when that is the lock, and the respawn state. Null for an
 *  unknown node id (a stale pick after a content change). */
export interface GatherNodeTooltipModel {
  type: GatherNodeDef['type'];
  professionId: GatheringProfessionId;
  tier: number;
  /** True when the viewer cannot work this node: no covering USABLE tool
   *  (the wield-filtered scan; 0 owned and owned-but-unearned both lock). */
  locked: boolean;
  /** The R22 wield arm, present exactly when the lock is a COUNTER
   *  shortfall: a covering tool is already carried and this is the smallest
   *  proficiency that would put something owned to work (the same
   *  minWieldRequirementToWork the sim's denial names). Absent when the
   *  lock is a plain tool/tier shortfall, so the painter keeps the tier
   *  line for that arm. */
  wieldSkill?: number;
  state: GatherNodeState;
  /** Remaining seconds until this node respawns for the viewer
   *  (IWorldProfessions nodeRespawnSeconds), present exactly when `state` is
   *  'cooldown' and the world put a number on the same timer; the painter
   *  keeps the untimed line for an absent value. */
  respawnSeconds?: number;
  /** The grade preview (the UX pass): true when the viewer's current
   *  wieldable tool, plus a usable slotted quality effect, would mint this
   *  node's FINE grade, resolved through the grant's own
   *  effectiveGradeToolTier read (never a second copy of the rule). Absent
   *  while the node is locked: the red requirement line owns that state. */
  fineUpgrade?: boolean;
}

/** Adapts the IWorld reads into the GradeReadMeta shape the sim's grade
 *  resolution takes, so the tooltip preview runs `effectiveGradeToolTier`
 *  itself (its promised third reader). Unknown and prototype-key effect ids
 *  are dropped: `applyEffectBonus` indexes TOOL_EFFECTS by the id and the
 *  row is wire-mirrored; a dropped row previews no bonus, the same degraded
 *  shape an unknown id renders everywhere else. */
function gradeReadMetaFor(world: IWorld): GradeReadMeta {
  const slots: NonNullable<GradeReadMeta['toolEffectSlots']> = {};
  for (const row of world.toolEffectSlots) {
    if (!Object.hasOwn(TOOL_EFFECTS, row.effectId)) continue;
    if (!(GATHERING_PROFESSION_IDS as readonly string[]).includes(row.professionId)) continue;
    slots[row.professionId as GatheringProfessionId] = {
      effectId: row.effectId as ToolEffectId,
      durability: row.charges,
      maxDurability: row.maxCharges,
      confirmMode: row.confirmMode,
    } satisfies ToolEffectSlot;
  }
  return {
    inventory: world.inventory,
    gatheringProficiency: world.gatheringProficiency,
    toolEffectSlots: slots,
  };
}

/** The R40 pre-harvest question, resolved for one node: non-null exactly when
 *  the viewer's slot for this node's profession is 'prompt'-mode AND a
 *  confirmed harvest would actually fire the effect (charges live, the R9
 *  suppression honored, through the sim's own applyToolEffectUse) AND the
 *  fire would MATTER (the grant's `mattered` predicate, mirrored: a quality
 *  effect on a tool already past the material's rung upgrades nothing and
 *  spends nothing, so it never asks) AND no locally knowable deny arm would
 *  refuse the harvest or the confirmed use. Null means send the harvest
 *  plain: no slot, 'always' mode, spent, suppressed, pointless, denied, or
 *  an unknown node id.
 *
 *  The deny mirror covers the sim arms the Entity mirror carries (dead,
 *  busy casting or consuming, action-locked shapeshift) plus the
 *  confirmed-grade capacity read through the sim's own countFit. Two
 *  honest limits (the fix-round review): the in-combat arm bites OFFLINE
 *  only (online mirrors never set p.inCombat, hud.ts's own note), so
 *  online it over-asks and the server's combat denial answers; and the
 *  busy/consuming reads trail the server by one snapshot online, so in
 *  that window a just-freed player's ask is suppressed and the plain
 *  harvest silently skips the effect, a one-round-trip loss the charge
 *  survives. The swimming arm stays server-side entirely (isSwimming is a
 *  SimContext position derivation, and a wrong local guess here would
 *  silently skip a legal use, the harmful direction). A denied state
 *  falls through to the plain harvest command and the server's own
 *  toast. */
export function gatherEffectPrompt(
  world: IWorld,
  nodeId: string,
): { effectId: string; charges: number } | null {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) return null;
  const professionId = NODE_HARVEST_TABLE[node.type].professionId;
  const meta = gradeReadMetaFor(world);
  const slot = meta.toolEffectSlots?.[professionId];
  if (!slot || slot.confirmMode !== 'prompt') return null;
  const p = world.player;
  if (p.dead || p.inCombat || p.castingAbility || isConsuming(p)) return null;
  if (p.auras.some((a) => isActionLockingFormAuraKind(a.kind))) return null;
  const fired = applyToolEffectUse(
    usableToolEffectSlot(meta, professionId, node),
    { quantity: 0, gradeToolTier: 0 },
    true,
  );
  if (!fired.applied) return null;
  // The mattered mirror: a quantity effect always adds units; a quality
  // effect matters only when the assisted and unassisted grade resolutions
  // mint DIFFERENT ids (both through the grant's own readers, so the ask
  // and the spend share one definition). Capacity aside: the grant's own
  // predicate runs AFTER truncation, so with room for the base yield but
  // not the bonus unit this asks and the sim then declines the spend,
  // which only keeps the charge.
  const assisted = effectiveGradeToolTier(meta, professionId, node, true);
  const unassisted = effectiveGradeToolTier(meta, professionId, node, false);
  const assistedYield = harvestYieldItemIdFor(node, assisted);
  const qtyChanges = fired.outcome.quantity > 0;
  if (!qtyChanges && assistedYield === harvestYieldItemIdFor(node, unassisted)) return null;
  // The confirmed-grade capacity mirror of the cast-start pre-gate: a
  // confirmed use the sim would refuse "Your bags are full." is a use that
  // will not happen, so it is never asked about. The asymmetric corner
  // (fine stacks, base does not): the ask still fires, confirming works,
  // and declining sends a plain harvest the sim's own pre-gate refuses
  // with its bags-full toast; asking is the arm that lets the harvest
  // succeed at all there.
  if (countFit(world.inventory, bagCapacity(world.bags), assistedYield, 1) < 1) return null;
  return { effectId: slot.effectId, charges: slot.durability };
}

export function buildGatherNodeTooltip(
  world: IWorld,
  nodeId: string,
): GatherNodeTooltipModel | null {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) return null;
  const professionId = NODE_HARVEST_TABLE[node.type].professionId;
  const locked = isNodeToolLockedFor(world, node);
  const wieldReq = locked
    ? minWieldRequirementToWork(world.inventory, professionId, node.tier, ITEMS)
    : null;
  const state = classifyGatherNode(world, node.id);
  const respawn = state === 'cooldown' ? world.nodeRespawnSeconds(node.id) : null;
  // The grade preview: fine exactly when the grant's own resolution would
  // mint an item id other than the node's base material. Suppressed while
  // locked (nothing can be harvested, so nothing is previewed).
  const fineUpgrade = locked
    ? undefined
    : harvestYieldItemIdFor(
        node,
        effectiveGradeToolTier(gradeReadMetaFor(world), professionId, node),
      ) !== nodeMaterialFor(node.type, node.zoneId).itemId;
  return {
    type: node.type,
    professionId,
    tier: node.tier,
    locked,
    ...(wieldReq !== null && wieldReq > 0 ? { wieldSkill: wieldReq } : {}),
    state,
    ...(respawn !== null && respawn > 0 ? { respawnSeconds: respawn } : {}),
    ...(fineUpgrade !== undefined ? { fineUpgrade } : {}),
  };
}

/** The i18n key the gatherDenied SimEvent's error toast resolves (the sim is
 *  text-free: the client composes its own copy off surface + professionId +
 *  requiredTier). Surface 'fishing' carries BOTH fishing denials and splits on
 *  requiredTier exactly like the node arm below: tier 1 is the startFishing
 *  implement gate (#2343, no tackle at all, so no tier is named), tier 2 and
 *  up is the zone rod gate (D9, this water takes a better rod, so the tier IS
 *  named). Without the split a player standing in Thornpeak holding a tier-2
 *  rod would be told to go and get a fishing pole they are already carrying.
 *  Surface 'node' splits the same way; anything unexpected falls back to the
 *  profession-neutral corpse line. */
export function gatherDeniedLineKey(
  surface: 'node' | 'corpse' | 'fishing',
  professionId?: GatheringProfessionId,
  requiredTier?: number,
  wieldProficiency?: number,
): TranslationKey {
  if (surface === 'fishing') {
    return requiredTier !== undefined && requiredTier > 1
      ? 'hudChrome.gathering.toolTierUnmet.fishing'
      : 'hudChrome.gathering.toolRequired.fishing';
  }
  if (surface === 'node') {
    if (professionId === 'mining' || professionId === 'logging' || professionId === 'herbalism') {
      // The R22 wield arm outranks the tier arms: when the event carries a
      // wield requirement, the player already OWNS a covering tool and the
      // actionable fact is the counter, not the tier.
      if (wieldProficiency !== undefined && wieldProficiency > 0) {
        return `hudChrome.gathering.wieldUnmet.${professionId}`;
      }
      return requiredTier !== undefined && requiredTier <= 1
        ? `hudChrome.gathering.toolRequired.${professionId}`
        : `hudChrome.gathering.toolTierUnmet.${professionId}`;
    }
  }
  if (wieldProficiency !== undefined && wieldProficiency > 0) {
    return 'hudChrome.gathering.wieldUnmetCorpse';
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
 *  100-proficiency deed is still locked. `maxSkill` is the profession's
 *  content cap, carried so every readout can render a DENOMINATOR: a bare
 *  moving integer is what reads as a character level to a new player. */
export interface GatheringProficiencyRow {
  professionId: GatheringProfessionId;
  value: number;
  displayValue: number;
  maxSkill: number;
}

/** Builds the proficiency display rows from IWorldProfessions#professionsState,
 *  in the fixed profession order, defaulting an absent/malformed entry to 0.
 *  The cap comes from the GATHERING_PROFESSIONS content table rather than the
 *  per-row wire value: it is the same number (gatheringSkillsView projects it
 *  from this very table) but it is total, so a missing or malformed skills row
 *  can never produce a nonsense "12 / 0" denominator. */
export function buildGatheringProficiencyRows(world: IWorld): GatheringProficiencyRow[] {
  const bySkill = new Map(world.professionsState.skills.map((s) => [s.professionId, s.skill]));
  return GATHERING_PROFESSION_IDS.map((professionId) => {
    const raw = bySkill.get(professionId);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return {
      professionId,
      value,
      displayValue: Math.floor(value),
      maxSkill: GATHERING_PROFESSIONS[professionId].maxSkill,
    };
  });
}
