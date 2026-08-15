// Material grades: the fine-gathered-material axis (D8).
//
// Before this, a better gathering tool bought exactly two things, access to
// higher-tier nodes and a shorter cast, and nothing else. The yield was
// identical whether you swung the 20-copper starter pick or the crafted
// tier-5 one, so there was no reason to chase a tool beyond the tier gate.
// This module adds the third thing: a harvest whose tool OUTCLASSES the
// material grants a `fine_` grade of that same material instead of the plain
// one. Same unit count, same rarity roll, same two rng draws; only the item
// id moves. The six crafted tool recipes then consume the fine grade, so the
// CRAFT route to the next tool up runs through the tool below it (the delve
// counters' Marks route is the deliberate non-craft alternative; see
// content/vendor_row_gates.ts and the delve shop tables).
//
// Pure leaf module: no SimContext, no content-table import, no rng, explicit
// arguments only, so a Vitest imports it directly (same contract as tools.ts
// and material_tier.ts).
//
// TWO TIER LADDERS LIVE IN THIS DIRECTORY AND THEY ARE NOT THE SAME LADDER.
// `MATERIAL_TIER_BY_ITEM` (material_tier.ts) is a PRICE band feeding the
// masterwork proc, where the eastbrook starter yields are deliberately tier 0
// and thorium_ore rides the mid band with the mirefen yields. `gatherTier`
// below is the ZONE progression the tool ladder is built on: eastbrook 1,
// mirefen 2, thornpeak 3. Reading the price band here instead would put a
// tier-1 tool strictly above the tier-0 eastbrook yields and turn every
// starter harvest fine, which is both wrong and golden-visible
// (material_tier.ts:12-17 records that its zero is load-bearing for exactly
// that reason).

/** One gathered material's grade pair and its place on the zone tier ladder. */
export interface MaterialGradeRow {
  /** The `fine_` id a tool-outclassed harvest yields instead of the base id. */
  readonly fineItemId: string;
  /**
   * The zone progression tier this material sits at: eastbrook_vale 1,
   * mirefen_marsh 2, thornpeak_heights 3. Keyed to the MATERIAL, never to the
   * individual node, because NODE_MATERIAL_TABLE resolves a yield from (type,
   * zone) alone and every tier of node in a zone collapses onto one item id.
   * A literal "one tier above the node" rule would read the node's tier and
   * make fine_thorium_ore farmable off a Thornpeak tier-1 vein with a tier-2
   * pick, a two-tier delta on the material that actually feeds the tier-4
   * pick recipe. `tests/material_grades.test.ts` derives this column from
   * GATHER_NODES (it is the highest node tier the zone carries) so a content
   * edit and this gate cannot drift apart.
   */
  readonly gatherTier: number;
}

/**
 * Every gathered node material that has a fine grade, keyed by its BASE id.
 * Exactly the nine NODE_MATERIAL_TABLE yields, three zones by three node
 * types. Deliberately a side table rather than a column on
 * NODE_MATERIAL_TABLE: that table's image is pinned to the nine-id
 * NODE_YIELDS literal in tests/recipe_economy.test.ts, and a fine grade is
 * not a tenth node yield, it is a second grade of an existing one.
 */
const MATERIAL_GRADE_ROWS: Record<string, MaterialGradeRow> = {
  copper_ore: { fineItemId: 'fine_copper_ore', gatherTier: 1 },
  ironbark_log: { fineItemId: 'fine_ironbark_log', gatherTier: 1 },
  silverleaf_herb: { fineItemId: 'fine_silverleaf_herb', gatherTier: 1 },
  iron_ore: { fineItemId: 'fine_iron_ore', gatherTier: 2 },
  ashwood_log: { fineItemId: 'fine_ashwood_log', gatherTier: 2 },
  goldleaf_herb: { fineItemId: 'fine_goldleaf_herb', gatherTier: 2 },
  thorium_ore: { fineItemId: 'fine_thorium_ore', gatherTier: 3 },
  elderwood_log: { fineItemId: 'fine_elderwood_log', gatherTier: 3 },
  sunpetal_herb: { fineItemId: 'fine_sunpetal_herb', gatherTier: 3 },
};

// Frozen ROW BY ROW, not just at the top level: Object.freeze is shallow, and a
// shallow freeze here would leave every { fineItemId, gatherTier } mutable at
// runtime while looking protected.
export const MATERIAL_GRADES: Readonly<Record<string, MaterialGradeRow>> = Object.freeze(
  Object.fromEntries(
    Object.entries(MATERIAL_GRADE_ROWS).map(([itemId, row]) => [itemId, Object.freeze(row)]),
  ),
);

// Reverse index, built once from the table above so the two directions can
// never fall out of step the way two hand-written literals would.
const BASE_BY_FINE_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(MATERIAL_GRADES).map(([baseItemId, row]) => [row.fineItemId, baseItemId]),
  ),
);

/** The fine grade of a base material id, or undefined for anything that has
 *  no fine grade (a mob drop, a vendor staple, a crafted tool, a fine id
 *  itself: grades do not stack). */
export function fineMaterialFor(baseItemId: string): string | undefined {
  return MATERIAL_GRADES[baseItemId]?.fineItemId;
}

/** The base grade a fine id upgrades, or undefined when the id is not a fine
 *  grade. The inverse of fineMaterialFor over the nine rows. */
export function baseMaterialFor(fineItemId: string): string | undefined {
  return BASE_BY_FINE_ID[fineItemId];
}

/** The zone tier ladder position of a base material, or undefined for an id
 *  with no fine grade. */
export function gatherMaterialTier(baseItemId: string): number | undefined {
  return MATERIAL_GRADES[baseItemId]?.gatherTier;
}

/**
 * Whether one harvest upgrades to the fine grade. BOTH conditions, and each
 * one carries its own weight:
 *
 * - `usableToolTier > gatherTier`: the tool must be strictly ABOVE the
 *   material, so the tool that merely unlocks a material never also improves
 *   it. Strict is what keeps the parity gather scenario (tier-1 tool, tier-1
 *   eastbrook nodes, gatherTier 1) on its shipped yields; `>=` would flip all
 *   102 of its harvests and move a golden.
 * - `nodeTier >= gatherTier`: the vein must be a full-grade vein for its zone.
 *   Mirefen and Thornpeak deliberately keep lower-tier nodes so a traveler
 *   carrying the quest-granted starter tool can still gather there, and this
 *   arm is what keeps those nodes yielding the PLAIN material: without it a
 *   tier-3 pick would turn every Mirefen vein fine and the base material
 *   would stop being gatherable at all for its owner.
 *
 * Pure comparison, no rng, no allocation: safe to call on both sides of a
 * capacity pre-gate and again at the grant, which is exactly how gathering.ts
 * uses it.
 */
export function yieldsFineGrade(
  gatherTier: number,
  nodeTier: number,
  usableToolTier: number,
): boolean {
  return usableToolTier > gatherTier && nodeTier >= gatherTier;
}

/**
 * Whether the fine grade of `baseItemId` is REACHABLE at a node of
 * `nodeTier` at any tool tier at all: yieldsFineGrade demands the node match
 * the material's own rung (nodeTier >= gatherTier), so on the v0.32.0
 * expansion's starter nodes (tier 1 everywhere, materials at rung 2 and 3)
 * no tool and no slotted bonus can ever mint the grade. The use-time charge
 * gate in gathering.ts reads this so a quality effect never spends a charge
 * on a categorically impossible upgrade. A material with no grade row is
 * never reachable.
 */
export function fineGradeReachable(baseItemId: string, nodeTier: number): boolean {
  const row = MATERIAL_GRADES[baseItemId];
  return row !== undefined && nodeTier >= row.gatherTier;
}

/**
 * The item id one harvest of `baseItemId` actually grants: the fine grade
 * when the tool outclasses the material at a full-grade vein, else the base
 * id unchanged. An id with no fine grade always returns itself, so a future
 * zone whose material row lands before its grade row degrades to the plain
 * yield rather than throwing.
 */
export function harvestGradeItemId(
  baseItemId: string,
  nodeTier: number,
  usableToolTier: number,
): string {
  const row = MATERIAL_GRADES[baseItemId];
  if (!row) return baseItemId;
  return yieldsFineGrade(row.gatherTier, nodeTier, usableToolTier) ? row.fineItemId : baseItemId;
}

/**
 * The ids that satisfy a requirement for `itemId`, in CONSUMPTION ORDER.
 *
 * Substitution runs DOWNWARD only: a fine grade satisfies a requirement for
 * its base (fine copper ore is copper ore, better), and the base never
 * satisfies a requirement for the fine grade, which is what makes the fine
 * grade a real gate on the six tool recipes. Base first, so a player holding
 * both spends the cheap grade and keeps the premium one.
 *
 * This is load-bearing rather than a courtesy. The fine grade REPLACES the
 * plain yield, and eastbrook_vale is all tier-1 nodes, so without downward
 * substitution a player carrying any tier-2 tool could no longer gather
 * copper_ore, ironbark_log or silverleaf_herb at all: two shipped repeatable
 * work orders (q_prof_workorder_forge, q_prof_workorder_toolworks) and every
 * tier-1 recipe fed by those three would become unfarmable for them.
 *
 * Returns a single-element list for every id with no fine grade, so callers
 * can walk this unconditionally instead of branching.
 */
export function materialGradeIds(itemId: string): readonly string[] {
  const fineItemId = MATERIAL_GRADES[itemId]?.fineItemId;
  return fineItemId ? [itemId, fineItemId] : [itemId];
}

/** One line of a grade-spanning removal: take `count` of `itemId`. */
export interface GradeRemoval {
  readonly itemId: string;
  readonly count: number;
}

/**
 * How to take `count` units of `itemId` across its grades, given how many of
 * each grade are available. Drains the base grade first, then the fine grade,
 * and emits no zero-count lines.
 *
 * Deliberately a PURE PLAN rather than two parallel removal loops. The craft
 * path has to make the identical decision twice, once on a scratch copy of
 * the inventory for the capacity pre-gate and once for real, and the two must
 * agree exactly or the gate approves a craft the consumption then performs
 * differently. One planner, two appliers.
 *
 * A short holding returns the plan for everything that IS available: callers
 * gate on their own count check first (hasRecipeMaterials, the quest collect
 * count), so this never has to invent a denial of its own.
 */
export function planGradeRemoval(
  itemId: string,
  count: number,
  available: (id: string) => number,
): readonly GradeRemoval[] {
  const plan: GradeRemoval[] = [];
  let remaining = count;
  for (const gradeId of materialGradeIds(itemId)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, available(gradeId)));
    if (take <= 0) continue;
    plan.push({ itemId: gradeId, count: take });
    remaining -= take;
  }
  return plan;
}

/** Units of `itemId` a holder has once its fine grade counts toward it.
 *  The read half of the same downward-substitution rule planGradeRemoval
 *  spends: both walk materialGradeIds, so a count can never promise units the
 *  removal would not find. */
export function countAcrossGrades(itemId: string, available: (id: string) => number): number {
  let total = 0;
  for (const gradeId of materialGradeIds(itemId)) total += Math.max(0, available(gradeId));
  return total;
}
