// Pure target-mat source resolver (phase 16): given one item id and the
// character's tools/proficiency/level, rank WHERE the mat comes from using
// the game's own tables. No IO, no clock: every table and every piece of
// character context rides in via TargetResolverDeps, so the test suite drives
// synthetic tables, the brain resolves at startup against the real ones, and
// the phase-18 launcher can answer /api/sources with a zero-context
// character (all gates open) from the same code.
//
// Verified mappings (see the plan):
//   gather: NODE_MATERIAL_TABLE[type][zoneId] -> {itemId, qtyByRarity},
//     positions from GATHER_NODES, tool-tier gate via canGatherTier.
//   fish: FISHING_TABLES_BY_BAND[band][zoneId] -> [{itemId, weight}], rod
//     gate via rodTierRequiredForZone, band = min(proficiency band, rod
//     band), spots from ZoneDef.lakes (hub-side shore, fishableAt-validated
//     lazily at runtime by the brain).
//   mob: MobTemplate.loot chances, camps from the CAMPS table, zone derived
//     from each camp center's rect.

import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { CAMPS, GATHER_NODES, ITEMS, MOBS, ZONES } from '../src/sim/data';
import { fishingBandFor, fishingRodBandFor } from '../src/sim/professions/fishing';
import { rodTierRequiredForZone } from '../src/sim/professions/fishing_zones';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { canGatherTier } from '../src/sim/professions/tools';
import type {
  CampDef,
  GatherNodeDef,
  GatherNodeType,
  InvSlot,
  ItemDef,
  MobTemplate,
  ZoneDef,
} from '../src/sim/types';

export type TargetSource =
  | {
      kind: 'gather';
      zoneId: string;
      nodeType: GatherNodeType;
      nodeIds: string[];
      minTier: number;
      score: number;
    }
  | {
      kind: 'fish';
      zoneId: string;
      band: 0 | 1 | 2;
      weightShare: number;
      spots: { x: number; z: number }[];
      score: number;
    }
  | {
      kind: 'mob';
      zoneId: string;
      mobId: string;
      chance: number;
      camps: CampDef[];
      // Informational only (gray mobs still drop loot): maxLevel - player
      // level, null when the template carries no levels. > 4 is the
      // survivability warning line; the brain's flee/survival kit owns risk.
      levelDiff: number | null;
      score: number;
    };

export interface TargetResolverDeps {
  nodes: readonly GatherNodeDef[];
  nodeMaterialTable: Record<
    GatherNodeType,
    Record<string, { itemId: string; qtyByRarity: Record<string, number> }>
  >;
  fishingTables: Record<string, { itemId: string | null; weight: number }[]>[];
  mobs: Record<string, MobTemplate>;
  camps: readonly CampDef[];
  zones: readonly ZoneDef[];
  items: Record<string, ItemDef>;
  // Character context: bag contents (tools/rods), the gatheringProficiency
  // mirror (online.ts), and the level for the mob levelDiff note.
  inventory: readonly InvSlot[];
  proficiencies: Record<string, number>;
  playerLevel: number;
}

// Node type -> gathering profession (the tool that opens the node).
const NODE_PROFESSION: Record<GatherNodeType, string> = {
  ore: 'mining',
  wood: 'logging',
  herb: 'herbalism',
};

// Score units (heuristic, per the plan): gather = expected common-rarity
// units per 240 s node-respawn cycle; fish = catches per cast (weight
// share); mob = expected drops per 60 s camp-respawn cycle.
const NODE_RESPAWN_SEC = 240;
const CAMP_RESPAWN_SEC = 60;

function toolTierFor(
  deps: TargetResolverDeps,
  inventory: readonly InvSlot[],
  professionId: string,
): number {
  let tier = 0;
  for (const slot of inventory) {
    const use = deps.items[slot.itemId]?.use;
    if (use?.type !== 'gatherTool' || use.professionId !== professionId) continue;
    if (use.tier > tier) tier = use.tier;
  }
  return tier;
}

// Best rod tier in the bags: tiered rods carry gatherTool tiers, the simple
// pole (use.type 'fishing') rides the bare-hands floor of 1. 0 = no rod.
function rodTierOf(deps: TargetResolverDeps, inventory: readonly InvSlot[]): number {
  let tier = 0;
  for (const slot of inventory) {
    const use = deps.items[slot.itemId]?.use;
    if (use?.type === 'fishing') tier = Math.max(tier, 1);
    if (use?.type === 'gatherTool' && use.professionId === 'fishing') {
      tier = Math.max(tier, use.tier);
    }
  }
  return tier;
}

function zoneForPoint(zones: readonly ZoneDef[], x: number, z: number): string | null {
  for (const zone of zones) {
    const xMin = zone.xMin ?? Number.NEGATIVE_INFINITY;
    const xMax = zone.xMax ?? Number.POSITIVE_INFINITY;
    if (x >= xMin && x <= xMax && z >= zone.zMin && z <= zone.zMax) return zone.id;
  }
  return null;
}

// Hub-side shore candidates for a lake: three points on the hub-facing arc,
// just inside the waterline. The brain's fishableAt probe skips dead ones at
// runtime, so the resolver stays seed-free.
export function lakeShoreSpots(
  lake: { x: number; z: number; radius: number },
  hub: { x: number; z: number },
): { x: number; z: number }[] {
  const dx = hub.x - lake.x;
  const dz = hub.z - lake.z;
  const base = Math.atan2(dx, dz);
  const r = Math.max(1, lake.radius - 1);
  const out: { x: number; z: number }[] = [];
  for (const off of [-Math.PI / 4, 0, Math.PI / 4]) {
    const a = base + off;
    out.push({
      x: Math.round((lake.x + Math.sin(a) * r) * 10) / 10,
      z: Math.round((lake.z + Math.cos(a) * r) * 10) / 10,
    });
  }
  return out;
}

export function resolveTarget(itemId: string, deps: TargetResolverDeps): TargetSource[] {
  const out: TargetSource[] = [];

  // --- gather sources -------------------------------------------------------
  for (const [nodeType, byZone] of Object.entries(deps.nodeMaterialTable) as [
    GatherNodeType,
    Record<string, { itemId: string; qtyByRarity: Record<string, number> }>,
  ][]) {
    const professionId = NODE_PROFESSION[nodeType];
    const toolTier = toolTierFor(deps, deps.inventory, professionId);
    for (const [zoneId, row] of Object.entries(byZone)) {
      if (row.itemId !== itemId) continue;
      const nodes = deps.nodes.filter((n) => n.zoneId === zoneId && n.type === nodeType);
      if (nodes.length === 0) continue;
      const minTier = Math.max(...nodes.map((n) => n.tier));
      if (!canGatherTier(toolTier, minTier)) continue; // tool gate
      const qty = row.qtyByRarity.common ?? 1;
      out.push({
        kind: 'gather',
        zoneId,
        nodeType,
        nodeIds: nodes.map((n) => n.id),
        minTier,
        score: (nodes.length * qty) / NODE_RESPAWN_SEC,
      });
    }
  }

  // --- fish sources ---------------------------------------------------------
  const rodTier = rodTierOf(deps, deps.inventory);
  if (rodTier > 0) {
    // The engine fishes exactly the effective band's cell (min of the
    // proficiency band and the rod's band cap), never a lower one.
    const effectiveBand = Math.min(
      fishingBandFor(deps.proficiencies.fishing ?? 0),
      fishingRodBandFor(rodTier),
    ) as 0 | 1 | 2;
    const table = deps.fishingTables[effectiveBand];
    for (const [zoneId, entries] of Object.entries(table ?? {})) {
      if (!canGatherTier(rodTier, rodTierRequiredForZone(zoneId))) continue; // rod gate
      const total = entries.reduce((sum, e) => sum + e.weight, 0);
      const hit = entries.find((e) => e.itemId === itemId);
      if (!hit || total <= 0) continue;
      const zone = deps.zones.find((z) => z.id === zoneId);
      const spots = zone ? zone.lakes.flatMap((lake) => lakeShoreSpots(lake, zone.hub)) : [];
      out.push({
        kind: 'fish',
        zoneId,
        band: effectiveBand,
        weightShare: hit.weight / total,
        spots,
        score: hit.weight / total,
      });
    }
  }

  // --- mob sources ----------------------------------------------------------
  for (const [mobId, template] of Object.entries(deps.mobs)) {
    const entry = template.loot?.find((l) => l.itemId === itemId && !l.questId);
    if (!entry || entry.chance <= 0) continue; // quest-gated drops: v1 skips
    const camps = deps.camps.filter((c) => c.mobId === mobId);
    if (camps.length === 0) continue;
    const zoneId = zoneForPoint(deps.zones, camps[0].center.x, camps[0].center.z);
    if (zoneId === null) continue;
    const count = camps.reduce((sum, c) => sum + c.count, 0);
    const maxLevel = template.maxLevel ?? template.minLevel;
    out.push({
      kind: 'mob',
      zoneId,
      mobId,
      chance: entry.chance,
      camps,
      levelDiff: maxLevel === undefined ? null : maxLevel - deps.playerLevel,
      score: (entry.chance * count) / CAMP_RESPAWN_SEC,
    });
  }

  // Best first; kind order breaks score ties deterministically.
  const kindOrder = { gather: 0, fish: 1, mob: 2 } as const;
  out.sort((a, b) => b.score - a.score || kindOrder[a.kind] - kindOrder[b.kind]);
  return out;
}

// The real-table resolver deps for a character context (brain startup; the
// launcher passes empty inventory/proficiencies for an all-gates-open
// preview).
export function defaultTargetResolverDeps(character: {
  inventory: readonly InvSlot[];
  proficiencies: Record<string, number>;
  playerLevel: number;
}): TargetResolverDeps {
  return {
    nodes: GATHER_NODES,
    nodeMaterialTable: NODE_MATERIAL_TABLE,
    fishingTables: FISHING_TABLES_BY_BAND,
    mobs: MOBS,
    camps: CAMPS,
    zones: ZONES,
    items: ITEMS,
    inventory: character.inventory,
    proficiencies: character.proficiencies,
    playerLevel: character.playerLevel,
  };
}
