// Sustainable farm yield: what a stretch of open world can pay per hour if a
// player kills everything in it as fast as it comes back.
//
// A TEST HELPER, not sim code: nothing in the live sim calls it, so it lives
// beside the suites that do rather than shipping unreferenced inside the
// deterministic core. It reads the real content tables and the real respawn
// policy, so it stays honest about the world it prices. It exists so the balance
// question "how much gold and XP per hour does this patch of world support?" is
// answered by one shared model that guard tests pin
// (tests/camp_density.test.ts, tests/economy_yield.test.ts), instead of by hand
// arithmetic in a review comment.
//
// The model is a CEILING, deliberately generous to the farmer: it assumes zero
// travel and kill time, every mob dead the instant it respawns, every non-quest
// drop vendored, and each mob at its template's top level. Real throughput is
// well under it. That is what makes it a useful guard: if even the ceiling is
// sane, the reality is.
//
// ONE INCOME STREAM IS DELIBERATELY EXCLUDED: corpse harvesting. A mob's
// componentTags open a profession path (interaction.ts harvestCorpse) whose
// yield depends on the harvester's profession level, tools and rarity rolls, so
// it is a property of the PLAYER, not of the camp, and folding a guess at it in
// would make these ceilings less comparable rather than more complete. The
// coinless harvest families are priced here at their loot-table value only,
// which for most of them is zero. Read a beast camp's copperPerHour as "coin and
// vendorable drops", not "everything a skinner can make from it".

import { CAMPS, ITEMS, MOBS, zoneContaining } from '../../src/sim/data';
import { resolveRespawnSeconds } from '../../src/sim/respawn_policy';
import type { CampDef, MobTemplate } from '../../src/sim/types';
import { mobXpValue } from '../../src/sim/types';

/**
 * Two camps join the same farm cluster when their centers are within this many
 * yards, transitively. It is a proximity model over camp CENTERS, so it asks
 * "would a farmer treat these as one route?", not "do the packs touch".
 */
export const CLUSTER_LINK_DISTANCE = 60;

/**
 * Guaranteed-plus-chance coin per kill, in copper, at the NOMINAL authored
 * value. The live roll spreads it (loot/loot_roll.ts rolls
 * `rng.int(ceil(c * 0.6), ceil(c * 1.4))`, inclusive), whose mean is exactly the
 * nominal value whenever c is a multiple of 5, which every curve fill is. Off
 * the fives the two ceils round the mean up a little, reaching about +17% on a
 * 3-copper drop, so this arm is very slightly CONSERVATIVE there rather than
 * generous. Called out because the rest of the model is deliberately generous to
 * the farmer, and that asymmetry should be visible instead of assumed away.
 */
export function coinEvPerKill(template: MobTemplate): number {
  let copper = 0;
  for (const entry of template.loot) {
    if (entry.copper) copper += entry.copper * entry.chance;
  }
  return copper;
}

/**
 * Vendor value per kill of the droppable items, in copper. Quest entries are
 * excluded: they only drop while their quest is active, and they are turn-in
 * fodder rather than income.
 */
export function itemEvPerKill(template: MobTemplate): number {
  let copper = 0;
  for (const entry of template.loot) {
    if (!entry.itemId || entry.questId) continue;
    const item = ITEMS[entry.itemId];
    if (item) copper += item.sellValue * entry.chance;
  }
  return copper;
}

/**
 * Kill XP for a player fighting this mob at its own level, including the elite
 * doubling and any xpMult. Mirrors the grant in combat/damage.ts.
 */
export function xpPerKill(template: MobTemplate, level: number): number {
  const eliteMult = (template.elite ? 2 : 1) * (template.xpMult ?? 1);
  return mobXpValue(level, level) * eliteMult;
}

export interface CampYield {
  camp: CampDef;
  template: MobTemplate;
  /** The zone the camp center sits in, or null off the authored map. */
  zoneId: string | null;
  /** Top of the template's level band: the ceiling a farmer sees. */
  level: number;
  respawnSeconds: number;
  /** count / respawn * 3600: the sustainable kill rate for this camp alone. */
  killsPerHour: number;
  copperPerHour: number;
  xpPerHour: number;
}

/**
 * One camp's sustainable yield at a given respawn delay. Respawn is passed in
 * rather than resolved here so the same model can price a hypothetical (a
 * proposed tier, or the pre-change world) as easily as the live one.
 */
export function campYield(camp: CampDef, respawnSeconds: number): CampYield | null {
  const template = MOBS[camp.mobId];
  if (!template) return null;
  const level = template.maxLevel;
  // A zero or negative delay would divide by zero; treat it as "no sustainable
  // ceiling exists" rather than silently reporting Infinity.
  const killsPerHour =
    respawnSeconds > 0 ? (camp.count / respawnSeconds) * 3600 : Number.POSITIVE_INFINITY;
  return {
    camp,
    template,
    zoneId: zoneContaining(camp.center.x, camp.center.z)?.id ?? null,
    level,
    respawnSeconds,
    killsPerHour,
    copperPerHour: killsPerHour * (coinEvPerKill(template) + itemEvPerKill(template)),
    xpPerHour: killsPerHour * xpPerKill(template, level),
  };
}

/** Every world camp priced at the respawn the live policy gives it. */
export function worldCampYields(camps: readonly CampDef[] = CAMPS): CampYield[] {
  const out: CampYield[] = [];
  for (const camp of camps) {
    const template = MOBS[camp.mobId];
    if (!template) continue;
    const y = campYield(camp, resolveRespawnSeconds(template, camp.center, undefined));
    if (y) out.push(y);
  }
  return out;
}

export interface FarmCluster {
  camps: CampYield[];
  /** Total mobs standing in the cluster at once. */
  mobCount: number;
  killsPerHour: number;
  copperPerHour: number;
  xpPerHour: number;
  zoneIds: string[];
  mobIds: string[];
}

/**
 * Union-find over camp centers: transitively joins any two camps within
 * `linkDistance` yards of each other, then totals each group.
 */
export function clusterCamps(
  yields: readonly CampYield[],
  linkDistance = CLUSTER_LINK_DISTANCE,
): FarmCluster[] {
  const parent = yields.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < yields.length; i++) {
    for (let j = i + 1; j < yields.length; j++) {
      const a = yields[i].camp.center;
      const b = yields[j].camp.center;
      if (Math.hypot(a.x - b.x, a.z - b.z) <= linkDistance) union(i, j);
    }
  }

  const groups = new Map<number, CampYield[]>();
  for (let i = 0; i < yields.length; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(yields[i]);
    else groups.set(root, [yields[i]]);
  }

  const clusters: FarmCluster[] = [];
  for (const camps of groups.values()) {
    clusters.push({
      camps,
      mobCount: camps.reduce((n, c) => n + c.camp.count, 0),
      killsPerHour: camps.reduce((n, c) => n + c.killsPerHour, 0),
      copperPerHour: camps.reduce((n, c) => n + c.copperPerHour, 0),
      xpPerHour: camps.reduce((n, c) => n + c.xpPerHour, 0),
      zoneIds: [...new Set(camps.map((c) => c.zoneId ?? 'none'))].sort(),
      mobIds: [...new Set(camps.map((c) => c.camp.mobId))].sort(),
    });
  }
  return clusters.sort((a, b) => b.copperPerHour - a.copperPerHour);
}

/** Convenience: the live world's farm clusters, richest first. */
export function worldFarmClusters(linkDistance = CLUSTER_LINK_DISTANCE): FarmCluster[] {
  return clusterCamps(worldCampYields(), linkDistance);
}
