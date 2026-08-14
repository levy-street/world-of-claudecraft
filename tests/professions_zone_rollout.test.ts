// The R37 rollout guard: professions content exists ONLY where a rollout row
// says it does, and the row says exactly how much. The v0.32.0 expansion
// changed the world this guard was written for: its eleven zones ship the
// release's own hub-outskirt STARTER kit (two tier-1 nodes per profession
// and tier-1 water), so "every zone past the built-in three is
// professions-free" stopped being true at that merge. The ledger now carries
// three states. 'complete' maps to assert-COMPLETE arms (the zone must carry
// nodes, a rod-tier row, a catch table in every band, and hub vendor rows).
// 'starter' pins the expansion shape exactly: nodes exist and every one is
// tier 1, the rod-tier row exists and is 1, and the zone has NO catch
// tables (Vale-row fallback), NO stations, and NO tool vendor rows; the
// phase 13 design pass (docs/design/professions-tuning-packet-review.md) is
// what flips a starter zone to complete alongside its full kit. 'none' maps
// to assert-ABSENT (no swept table may reference the zone) and stays the
// default for any future zone. Adding content without flipping a row fails
// loudly, and so does flipping a row without the content, which is exactly
// the two-sided guard R37 asks for. Every sweep is DERIVED from the live
// tables with per-table non-vacuity, never a hand-kept list of what exists.
import { describe, expect, it } from 'vitest';
import { GUIDE_PROF_GATHERING } from '../src/guide/content.generated';
import { DEEDS } from '../src/sim/content/deeds';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import {
  FARM_CROPS,
  FARM_MATERIAL_ITEM_IDS,
  FARM_SUPPLY_ITEM_IDS,
  FARM_WITHERED_HUSK_ITEM_ID,
} from '../src/sim/content/farm_crops';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { GATHERING_PROFESSIONS, STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES, FARM_RECIPES, HOE_RECIPES } from '../src/sim/content/recipes';
import { ZONE1_NPCS } from '../src/sim/content/zone1';
import { ZONE2_NPCS } from '../src/sim/content/zone2';
import { ZONE3_NPCS } from '../src/sim/content/zone3';
import { GATHER_NODE_TYPES, GATHER_NODES, ITEMS, NPCS, ZONES } from '../src/sim/data';
import { ZONE_FISH } from '../src/sim/deeds';
import { FARMING_ZONE_TIERS } from '../src/sim/professions/farming_zones';
import { FISHING_ZONE_ROD_TIERS } from '../src/sim/professions/fishing_zones';
import {
  gatherNodeGainMultiplier,
  NODE_HARVEST_TABLE,
  NODE_MATERIAL_TABLE,
} from '../src/sim/professions/gathering';
import { MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { wieldRequirementForTier } from '../src/sim/professions/wield_gate';
import { Sim } from '../src/sim/sim';
import { itemNames } from '../src/ui/i18n.catalog/items';
import { isUnknownIconRecipe, itemIconRecipe } from '../src/ui/icons';
import { placeAtHarvestSpot } from './helpers/harvest_spot';

/**
 * The R37 ledger, and deliberately the ONLY hand-kept table in this file.
 * A future zone ships with an explicit 'none' row (professions-free until its
 * design pass, the R37 default). The v0.32.0 expansion zones carry 'starter'
 * (the release's shipped hub-outskirt kit, pinned to exactly that shape by
 * the arms below); their phase 13 design pass flips each to 'complete'.
 * Shipping a ZoneDef with no row at all is refused by the coverage arm: the
 * decision must be recorded here either way.
 */
type RolloutState = 'complete' | 'starter' | 'none';
const PROFESSIONS_ZONE_ROLLOUT: Readonly<Record<string, RolloutState>> = {
  eastbrook_vale: 'complete',
  mirefen_marsh: 'complete',
  thornpeak_heights: 'complete',
  veiled_hollow: 'starter',
  drakelands: 'starter',
  frostveil: 'starter',
  amberfall: 'starter',
  willowfen: 'starter',
  nightbloom: 'starter',
  wraithwood: 'starter',
  palmreach: 'starter',
  evergarden: 'starter',
  galecrest: 'starter',
  farshore_isle: 'starter',
};

/** The zones the assert-complete arms sweep: every 'complete' ledger row. */
function rolledOutFrom(ledger: Readonly<Record<string, RolloutState>>): Set<string> {
  return new Set(
    Object.entries(ledger)
      .filter(([, state]) => state === 'complete')
      .map(([zoneId]) => zoneId),
  );
}

/** The zones a given state's arms sweep. */
function zonesInState(state: RolloutState): Set<string> {
  return new Set(
    Object.entries(PROFESSIONS_ZONE_ROLLOUT)
      .filter(([, s]) => s === state)
      .map(([zoneId]) => zoneId),
  );
}

const ROLLED_OUT = rolledOutFrom(PROFESSIONS_ZONE_ROLLOUT);
const STARTER_ZONES = zonesInState('starter');

/** Every professions implement in the item table (land tools and rods). */
function professionToolIds(): Set<string> {
  const out = new Set<string>();
  for (const [itemId, def] of Object.entries(ITEMS)) {
    if (def.use?.type === 'gatherTool') out.add(itemId);
  }
  return out;
}

describe('the R37 professions zone-rollout guard', () => {
  it('the rollout ledger covers exactly the shipped ZONES (the flip point is deliberate)', () => {
    // Adding a fourth ZoneDef fails HERE first, by design: the author must
    // decide, in this file, whether the new zone ships professions content
    // (a 'complete' row plus the content) or ships without (an explicit
    // 'none' row, and every sweep below enforces the absence).
    expect([...ZONES.map((z) => z.id)].sort()).toEqual(
      [...Object.keys(PROFESSIONS_ZONE_ROLLOUT)].sort(),
    );
    expect(ZONES.length).toBe(14);
    expect(ROLLED_OUT.size).toBe(3);
    expect(STARTER_ZONES.size).toBe(11);
    // The 'none' state is real, not decorative: no shipped row uses it yet,
    // so without this arm the complete-filter could silently degrade to a
    // bare key read and a future professions-free zone would sweep as
    // rolled out, defeating the guard's whole purpose.
    expect(rolledOutFrom({ ...PROFESSIONS_ZONE_ROLLOUT, zone_x: 'none' })).toEqual(ROLLED_OUT);
  });

  it('gather nodes exist in every complete and starter zone, and ONLY there', () => {
    expect(GATHER_NODES.length).toBeGreaterThan(0);
    const byZone = new Map<string, number>();
    for (const node of GATHER_NODES) {
      byZone.set(node.zoneId, (byZone.get(node.zoneId) ?? 0) + 1);
      expect(
        ROLLED_OUT.has(node.zoneId) || STARTER_ZONES.has(node.zoneId),
        `${node.id} places a professions node in un-rolled-out zone ${node.zoneId}`,
      ).toBe(true);
      // The starter shape's teeth: every expansion node is tier 1 until the
      // zone's phase 13 pass flips the row (a tier-2 vein appearing in a
      // starter zone means content landed without the ledger decision).
      if (STARTER_ZONES.has(node.zoneId)) {
        expect(node.tier, `${node.id} outruns its starter zone's tier-1 kit`).toBe(1);
      }
    }
    for (const zoneId of [...ROLLED_OUT, ...STARTER_ZONES]) {
      expect(
        byZone.get(zoneId) ?? 0,
        `${zoneId} ships nodes by its row but has none`,
      ).toBeGreaterThan(0);
    }
    // The starter shape EXACTLY, per type and per zone. The uniform
    // two-per-type kit was the v0.32.0 release's authored shape; the phase
    // 20 density pass (docs/design/professions-tuning-packet-review.md, the
    // +36 bottom-three set, Q9 and Q12) grew willowfen, galecrest, and
    // farshore_isle to six per type while their ledger rows deliberately
    // stayed 'starter' (density is not rollout: a 'complete' flip also
    // demands a crafting station, catch tables in every band, and the rest
    // of the checklist below, which remains the zone-4 pass's decision). So
    // the pin is a per-zone expected count rather than one number: a zone
    // silently losing its herbs while keeping ore must still red here, and
    // a density change that skips this ledger must too.
    const STARTER_NODES_PER_TYPE: Readonly<Record<string, number>> = {
      veiled_hollow: 2,
      drakelands: 2,
      frostveil: 2,
      amberfall: 2,
      willowfen: 6,
      nightbloom: 2,
      wraithwood: 2,
      palmreach: 2,
      evergarden: 2,
      galecrest: 6,
      farshore_isle: 6,
    };
    expect(new Set(Object.keys(STARTER_NODES_PER_TYPE))).toEqual(STARTER_ZONES);
    for (const zoneId of STARTER_ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        const ofType = GATHER_NODES.filter((n) => n.zoneId === zoneId && n.type === type);
        expect(ofType.length, `${zoneId} ${type} starter kit`).toBe(STARTER_NODES_PER_TYPE[zoneId]);
      }
    }
  });

  it('crafting stations sit only in rolled-out zones, and every rolled-out zone has one', () => {
    expect(STATIONS.length).toBeGreaterThan(0);
    const byZone = new Map<string, number>();
    for (const station of STATIONS) {
      byZone.set(station.zoneId, (byZone.get(station.zoneId) ?? 0) + 1);
      expect(
        ROLLED_OUT.has(station.zoneId),
        `${station.id} places a station in un-rolled-out zone ${station.zoneId}`,
      ).toBe(true);
    }
    // Assert-complete, not just assert-absent: a rolled-out zone with no
    // station at all (the whole Thornpeak bench deleted, say) must redden
    // here, not sweep as fine.
    for (const zoneId of ROLLED_OUT) {
      expect(byZone.get(zoneId) ?? 0, `${zoneId} is rolled out but has no station`).toBeGreaterThan(
        0,
      );
    }
  });

  it('rod-tier rows and catch tables exist for every rolled-out zone and no other', () => {
    // The rod ladder (R19/R22 read this map) and the per-band catch tables
    // are both zone-keyed. A future zone's water stays tier-1-by-default,
    // but NOT catchless: the catch resolver falls back to the Vale rows for
    // any zone without its own table (fishing.ts), so absence here means
    // DEFAULT water, and the zone's own tables are part of what its
    // 'complete' flip must author.
    // Rod rows exist for complete AND starter zones (a starter row is the
    // explicit tier-1 decision fishing_zones.ts records); catch tables stay
    // complete-only, the Vale fallback covering starter water.
    expect([...Object.keys(FISHING_ZONE_ROD_TIERS)].sort()).toEqual(
      [...ROLLED_OUT, ...STARTER_ZONES].sort(),
    );
    for (const zoneId of STARTER_ZONES) {
      expect(FISHING_ZONE_ROD_TIERS[zoneId], `${zoneId} starter water is not tier 1`).toBe(1);
    }
    expect(FISHING_TABLES_BY_BAND.length).toBeGreaterThan(0);
    for (const [band, byZone] of FISHING_TABLES_BY_BAND.entries()) {
      const zones = Object.keys(byZone);
      expect(zones.length, `band ${band} has no zone tables`).toBeGreaterThan(0);
      expect([...zones].sort(), `band ${band} zone keys`).toEqual([...ROLLED_OUT].sort());
      for (const [zoneId, table] of Object.entries(byZone)) {
        expect(table.length, `band ${band} ${zoneId} table is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('professions tools are vendored only by NPCs of the three zone tables', () => {
    // A future zone or custom map lands its NPCs OUTSIDE these three content
    // tables, so a professions tool on such a counter is exactly the vendor
    // row R37 forbids (and R23 routes future-tier tools through content, not
    // counters, so hubs deliberately never stock a future zone's rung).
    const tools = professionToolIds();
    expect(tools.size).toBeGreaterThanOrEqual(12);
    const zoneTables: [string, Set<string>][] = [
      ['zone1', new Set(Object.keys(ZONE1_NPCS))],
      ['zone2', new Set(Object.keys(ZONE2_NPCS))],
      ['zone3', new Set(Object.keys(ZONE3_NPCS))],
    ];
    const zoneNpcIds = new Set(zoneTables.flatMap(([, ids]) => [...ids]));
    let toolRowsSeen = 0;
    const rowsPerTable = new Map<string, number>();
    for (const [npcId, npc] of Object.entries(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        if (!tools.has(itemId)) continue;
        toolRowsSeen += 1;
        for (const [table, ids] of zoneTables) {
          if (ids.has(npcId)) rowsPerTable.set(table, (rowsPerTable.get(table) ?? 0) + 1);
        }
        expect(
          zoneNpcIds.has(npcId),
          `${npcId} vendors professions tool ${itemId} from outside the zone tables`,
        ).toBe(true);
      }
    }
    // Non-vacuity: the sweep really saw the shipped tool rows, and saw them
    // in EVERY zone table (a global floor alone would stay green with a
    // whole hub's counter deleted).
    expect(toolRowsSeen).toBeGreaterThan(10);
    for (const [table] of zoneTables) {
      expect(rowsPerTable.get(table) ?? 0, `${table} contributes no tool row`).toBeGreaterThan(0);
    }
    // The two non-NPC counters are covered by their own sweeps
    // (tests/professions_tools.test.ts): pin here only that neither has
    // sprouted a row this guard would need to zone-resolve. Local non-vacuity
    // for both, so an emptied or renamed table reads as a failure here, not
    // as a vacuous pass delegated to another file.
    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_STOCK.some((offer) => tools.has(offer.itemId))).toBe(false);
    let delveToolRows = 0;
    for (const [delveId, entries] of Object.entries(DELVE_SHOPS)) {
      for (const entry of entries) {
        if (!tools.has(entry.itemId)) continue;
        delveToolRows += 1;
        // Delve counters DO stock the tier-4/5 crafted tools (the Marks
        // route); every delve lives in a rolled-out zone today, pinned by
        // the delve id naming convention staying within the shipped set.
        expect(
          ['collapsed_reliquary', 'drowned_litany'].includes(delveId),
          `${delveId} delve shop stocks tool ${entry.itemId} outside the shipped delves`,
        ).toBe(true);
      }
    }
    // The Marks-route rows really exist, so the loop above discriminated.
    expect(delveToolRows).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The NEW-ZONE CHECKLIST (phase 13 of the packet review): the assert-complete
// half of the R37 flip. Every arm below walks the ledger's 'complete' rows,
// so flipping a starter zone to 'complete' conscripts it into the WHOLE
// checklist at once: a future zone must arrive mechanically whole (six nodes
// per type on a real tier ladder, materials with fine twins, the tool and
// rod rungs it opens, catch tables in every band, hub stocking per the hub
// rule with the ladder top routed through content per R23, wield
// requirements reachable per R22's knife-edge rule, deeds, and wiki
// presence) or red the gate. Everything is derived from the live tables;
// the ledger stays the one hand-kept decision.
// ---------------------------------------------------------------------------

describe('the new-zone checklist: every complete zone arrives mechanically whole', () => {
  const complete = [...rolledOutFrom(PROFESSIONS_ZONE_ROLLOUT)].sort();
  const zoneOf = (zoneId: string) => {
    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`ledger zone ${zoneId} is not in ZONES`);
    return zone;
  };
  const nodesIn = (zoneId: string) => GATHER_NODES.filter((n) => n.zoneId === zoneId);
  const zoneTierOf = (zoneId: string) => Math.max(...nodesIn(zoneId).map((n) => n.tier));
  const landTools = Object.entries(ITEMS).filter(
    ([, def]) => def.use?.type === 'gatherTool' && def.use.professionId !== 'fishing',
  );
  const rods = Object.entries(ITEMS).filter(
    ([, def]) => def.use?.type === 'gatherTool' && def.use.professionId === 'fishing',
  );

  it('the checklist sweeps a real, non-vacuous complete set', () => {
    expect(complete.length).toBeGreaterThanOrEqual(3);
  });

  it('six nodes per type, an entry rung, and at least one node of the zone tier', () => {
    for (const zoneId of complete) {
      const zoneTier = zoneTierOf(zoneId);
      for (const type of GATHER_NODE_TYPES) {
        const ofType = nodesIn(zoneId).filter((n) => n.type === type);
        expect(ofType.length, `${zoneId} ${type} circuit floor`).toBeGreaterThanOrEqual(6);
        expect(
          ofType.some((n) => n.tier === 1),
          `${zoneId} ${type} needs a tier-1 entry node`,
        ).toBe(true);
      }
      expect(
        nodesIn(zoneId).some((n) => n.tier === zoneTier),
        `${zoneId} tier assignment must be carried by a real node`,
      ).toBe(true);
    }
  });

  it('ground and water agree on the zone tier (one progression ladder)', () => {
    for (const zoneId of complete) {
      expect(FISHING_ZONE_ROD_TIERS[zoneId], `${zoneId} rod tier`).toBe(zoneTierOf(zoneId));
    }
  });

  it('every node material resolves and carries its fine twin with a real def', () => {
    for (const zoneId of complete) {
      for (const type of GATHER_NODE_TYPES) {
        const row = NODE_MATERIAL_TABLE[type][zoneId];
        expect(row, `${zoneId} ${type} material row`).toBeDefined();
        expect(ITEMS[row.itemId], `${zoneId} ${type} material def`).toBeDefined();
        const grade = MATERIAL_GRADES[row.itemId];
        expect(grade, `${zoneId} ${type} material needs a fine-grade row (D8)`).toBeDefined();
        expect(ITEMS[grade.fineItemId], `${zoneId} ${type} fine def`).toBeDefined();
      }
    }
  });

  it('the tool and rod rungs a zone opens exist in the catalog', () => {
    for (const zoneId of complete) {
      const zoneTier = zoneTierOf(zoneId);
      for (const professionId of new Set(
        Object.values(NODE_HARVEST_TABLE).map((entry) => entry.professionId),
      )) {
        expect(
          landTools.some(
            ([, def]) =>
              def.use?.type === 'gatherTool' &&
              def.use.professionId === professionId &&
              def.use.tier === zoneTier,
          ),
          `${zoneId} opens tier ${zoneTier}: ${professionId} needs a tool of that rung`,
        ).toBe(true);
      }
      if (zoneTier >= 2) {
        expect(
          rods.some(([, def]) => def.use?.type === 'gatherTool' && def.use.tier === zoneTier),
          `${zoneId} water takes a tier-${zoneTier} rod, which must exist`,
        ).toBe(true);
      }
    }
  });

  it('every band carries the zone catch table, summing to 100 with an empty-hook row', () => {
    for (const zoneId of complete) {
      FISHING_TABLES_BY_BAND.forEach((band, index) => {
        const table = band[zoneId];
        expect(table, `${zoneId} band ${index} table`).toBeDefined();
        expect(
          table.reduce((sum, entry) => sum + entry.weight, 0),
          `${zoneId} band ${index} weights`,
        ).toBe(100);
        expect(
          table.some((entry) => entry.itemId === null),
          `${zoneId} band ${index} empty-hook row`,
        ).toBe(true);
      });
    }
  });

  it('the hub stocks the rungs its own nodes use, and the water rod; ladder tops never (hub rule, R20, R23)', () => {
    // The exclusion-set pins (asserted after the zone loop): the (aa)
    // farming skip below is held by these, not by its comment alone. The
    // Phase 5 QA mutation probe widened the skip to mining and the whole
    // suite stayed green; these two sets are what red that now, in both
    // directions (a widened skip lands in hubSkipped, a rewritten condition
    // that drops a node profession from the walk empties hubAsserted).
    const hubSkipped = new Set<string>();
    const hubAsserted = new Set<string>();
    for (const zoneId of complete) {
      const zone = zoneOf(zoneId);
      const zoneTier = zoneTierOf(zoneId);
      const hub = zone.hub;
      expect(hub, `${zoneId} needs a hub`).toBeDefined();
      const hubStock = new Set<string>();
      for (const npc of Object.values(NPCS)) {
        if (!npc.vendorItems?.length) continue;
        const d = Math.hypot(npc.pos.x - hub.x, npc.pos.z - hub.z);
        if (d > hub.radius * 2) continue;
        for (const itemId of npc.vendorItems) hubStock.add(itemId);
      }
      // Land side, both directions: every vendor-priced land tier up to the
      // zone tier is on the counter, and nothing above the zone tier is.
      // FARMING IS EXCLUDED from this scan exactly as fishing is (the
      // landTools collector above): the hub rule is about the rungs a zone's
      // own NODES use, and farming has no nodes (D2, fishing-shaped). Its
      // vendor state is dormant by choice until the Phase 9 farmer NPCs
      // stock the counters, and the farming ladder's own dormant-state arm
      // below pins that no-vendor truth positively. Do not widen this
      // exclusion to the three node professions.
      for (const [itemId, def] of landTools) {
        if (def.use?.type !== 'gatherTool') continue;
        if (def.use.professionId === 'farming') {
          hubSkipped.add(def.use.professionId);
          continue;
        }
        hubAsserted.add(def.use.professionId);
        const priced = def.buyValue !== undefined;
        if (priced && def.use.tier <= zoneTier) {
          expect(hubStock.has(itemId), `${zoneId} hub should stock ${itemId}`).toBe(true);
        }
        if (def.use.tier > zoneTier) {
          expect(hubStock.has(itemId), `${zoneId} hub must not stock ${itemId}`).toBe(false);
        }
      }
      // Rod side: a tiered-water hub stocks exactly the rod its water takes;
      // the tier-1 zone hub is the R20 buy-ahead counter and may carry the
      // whole vendor-priced ladder, never a crafted rung.
      const rodsStocked = rods.filter(([itemId]) => hubStock.has(itemId));
      if (zoneTier >= 2) {
        expect(
          rodsStocked.some(
            ([, def]) => def.use?.type === 'gatherTool' && def.use.tier === zoneTier,
          ),
          `${zoneId} hub must stock the rod its water takes`,
        ).toBe(true);
        for (const [itemId, def] of rodsStocked) {
          expect(
            def.use?.type === 'gatherTool' && def.use.tier <= zoneTier,
            `${zoneId} hub stocks ${itemId} above its own water`,
          ).toBe(true);
        }
      } else {
        for (const [itemId, def] of rodsStocked) {
          expect(def.buyValue !== undefined, `${zoneId} hub sells unpriced rod ${itemId}`).toBe(
            true,
          );
        }
      }
    }
    // The (aa) exclusion is EXACTLY farming (fishing never enters landTools),
    // and every node profession really passed through the stocked-rung walk.
    expect([...hubSkipped]).toEqual(['farming']);
    expect([...hubAsserted].sort()).toEqual(['herbalism', 'logging', 'mining']);
  });

  it('the ladder top rungs route through content, never a counter (R23)', () => {
    const professionTops = new Map<string, number>();
    for (const [, def] of [...landTools, ...rods]) {
      if (def.use?.type !== 'gatherTool') continue;
      const top = professionTops.get(def.use.professionId) ?? 0;
      if (def.use.tier > top) professionTops.set(def.use.professionId, def.use.tier);
    }
    expect(professionTops.size).toBeGreaterThanOrEqual(4);
    const delveRows = Object.values(DELVE_SHOPS).flat();
    for (const [itemId, def] of [...landTools, ...rods]) {
      if (def.use?.type !== 'gatherTool') continue;
      if (def.use.tier !== professionTops.get(def.use.professionId)) continue;
      expect(def.buyValue, `${itemId} is a ladder top and must never price for copper`).toBe(
        undefined,
      );
      const crafted = ALL_RECIPES.some((recipe) => recipe.resultItemId === itemId);
      const marks = delveRows.some((row) => row.itemId === itemId && row.gate !== 'available');
      expect(
        crafted || marks,
        `${itemId} names no content source (recipe or gated Marks row)`,
      ).toBe(true);
    }
  });

  it('every wield requirement a zone asks is reachable on the ladder below it (R22 knife-edge)', () => {
    // The land cap read from the profession record, never a copied 100: the
    // sibling ceiling helper (tests/professions_tool_gate.test.ts) reads the
    // same constant, so a cap retune moves both at once.
    const cap = GATHERING_PROFESSIONS.mining.maxSkill;
    const teachingCeilingFor = (nodeTier: number): number => {
      for (let proficiency = 0; proficiency <= cap; proficiency++) {
        if (gatherNodeGainMultiplier(proficiency, nodeTier) === 0) return proficiency;
      }
      return cap;
    };
    // Per node TYPE (which maps one-to-one onto a land profession): pooling
    // tiers across professions would let a zone whose only tier-2 ground is
    // herb patches vouch for a tier-3 PICK requirement the mining counter
    // cannot actually climb to.
    for (const type of GATHER_NODE_TYPES) {
      const tiersPresent = new Set(
        complete.flatMap((zoneId) =>
          nodesIn(zoneId)
            .filter((n) => n.type === type)
            .map((n) => n.tier),
        ),
      );
      expect(tiersPresent.size, `${type} ships at least one tier`).toBeGreaterThan(0);
      for (const tier of tiersPresent) {
        if (tier < 2) continue;
        const below = [...tiersPresent].filter((t) => t < tier);
        expect(
          below.length,
          `${type} tier ${tier} needs ground below it somewhere`,
        ).toBeGreaterThan(0);
        const reachable = Math.max(...below.map(teachingCeilingFor));
        expect(
          wieldRequirementForTier(tier),
          `${type} tier ${tier} wield requirement must be reachable on its own ladder below`,
        ).toBeLessThanOrEqual(reachable);
      }
    }
  });

  it('every complete zone has its gatherer chronicle and first-cast deed, EARNABLE', () => {
    for (const zoneId of complete) {
      const gatherMarks = GATHER_NODE_TYPES.map((type) => `gather:${zoneId}:${type}`);
      // The chronicle must be VISIBLE (a hidden deed advertises nothing and
      // satisfies no player-facing coverage claim) and ZONE-OWNED: every
      // gather mark in its trigger belongs to this zone, so one shared
      // multi-zone deed cannot satisfy two zones' checklist rows at once.
      expect(
        Object.values(DEEDS).some((deed) => {
          const trigger = deed.trigger;
          return (
            !deed.hidden &&
            trigger.kind === 'visits' &&
            gatherMarks.every((mark) => trigger.markIds.includes(mark)) &&
            trigger.markIds
              .filter((mark) => mark.startsWith('gather:'))
              .every((mark) => gatherMarks.includes(mark))
          );
        }),
        `${zoneId} needs a visible zone-owned gatherer chronicle over all three node types (R21)`,
      ).toBe(true);
      expect(
        Object.values(DEEDS).some(
          (deed) =>
            !deed.hidden &&
            deed.trigger.kind === 'visit' &&
            deed.trigger.markId === `fish:${zoneId}`,
        ),
        `${zoneId} needs its first-cast fishing deed`,
      ).toBe(true);
      // EARNABLE, not just declared: the fish:<zone> mark only ever writes
      // when the deed evaluator's own catch table lists real fish for the
      // zone (src/sim/deeds.ts ZONE_FISH), so a first-cast deed without a
      // row here would ship permanently uncompletable.
      expect(
        (ZONE_FISH[zoneId] ?? []).length,
        `${zoneId} first-cast deed needs ZONE_FISH rows to ever fire`,
      ).toBeGreaterThan(0);
      // And the rows must be CATCHABLE HERE, not merely real items: the mark
      // writer fires only for a listed catch the resolver actually drew from
      // THIS zone's own band tables (src/sim/deeds.ts onFishCaughtForDeeds,
      // fed by the table draw in professions/fishing.ts). A row naming a fish
      // this water never yields is the same permanently uncompletable deed as
      // a missing row, so intersect the two. Read without the resolver's
      // Vale fallback on purpose: a complete zone that lost its own tables
      // would fish for Vale rows under its own zone id, and that is a
      // failure here rather than an accidental pass.
      const catchableHere = new Set<string>();
      for (const band of FISHING_TABLES_BY_BAND) {
        for (const entry of band[zoneId] ?? []) {
          if (entry.itemId !== null) catchableHere.add(entry.itemId);
        }
      }
      expect(
        catchableHere.size,
        `${zoneId} draws no named catch in any band, so the intersection below is vacuous`,
      ).toBeGreaterThan(0);
      for (const itemId of ZONE_FISH[zoneId] ?? []) {
        expect(
          ITEMS[itemId],
          `${zoneId} ZONE_FISH row ${itemId} must be a real item`,
        ).toBeDefined();
        expect(
          catchableHere.has(itemId),
          `${zoneId} ZONE_FISH row ${itemId} is never drawn by that zone's catch tables`,
        ).toBe(true);
      }
    }
  });

  it('the gather mark a REAL harvest writes is the mark the chronicle waits on (live)', () => {
    // The arm above builds `gather:<zone>:<type>` from its own template and
    // compares it against a deed trigger built from the same one, so both
    // sides are DERIVED and the actual producer (professions/gathering.ts,
    // the markVisited call on the granted harvest path) is never exercised.
    // Renaming the template there would leave all three gatherer chronicles
    // permanently uncompletable with nothing red. So drive one real harvest
    // through a live Sim and read back the mark the producer itself wrote:
    // the three node types share that single call site, so this pins the
    // template for the WHOLE gather family. The fish: sibling is pinned live
    // by the extracted-module deeds arm in tests/professions_fishing.test.ts.
    const MARK = 'gather:mirefen_marsh:ore';
    // The fixture is derived, not a node-id literal: the lowest-tier ore node
    // in the marsh, so the covering tool is the cheapest rung on the ladder.
    const node = nodesIn('mirefen_marsh')
      .filter((n) => n.type === 'ore')
      .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))[0];
    expect(node, 'the drive needs a mirefen ore node').toBeDefined();
    expect(`gather:${node.zoneId}:${node.type}`, 'the fixture must spell MARK').toBe(MARK);
    const professionId = NODE_HARVEST_TABLE[node.type].professionId;
    // The cheapest land tool of the node's OWN profession that covers its
    // tier, and exactly the proficiency R22 makes that tool wield at: both
    // derived, so a ladder retune cannot quietly leave this drive denied.
    let toolId = '';
    let toolTier = Number.POSITIVE_INFINITY;
    for (const [itemId, def] of landTools) {
      const use = def.use;
      if (use?.type !== 'gatherTool') continue;
      if (use.professionId !== professionId || use.tier < node.tier) continue;
      if (use.tier >= toolTier) continue;
      toolId = itemId;
      toolTier = use.tier;
    }
    expect(toolId, `${professionId} needs a tool covering tier ${node.tier}`).not.toBe('');

    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'MarkDrive');
    const meta = sim.players.get(pid);
    if (!meta) throw new Error(`missing player meta ${pid}`);
    const p = sim.entities.get(pid);
    if (!p) throw new Error(`missing player entity ${pid}`);
    sim.addItem(toolId, 1, pid);
    meta.gatheringProficiency[professionId] = wieldRequirementForTier(toolTier);
    placeAtHarvestSpot(sim, pid, node.id);
    // Mob damage cancels a gather cast mid-drive, so the world is cleared and
    // kept clear first (the tests/gather_node_harvest.test.ts idiom).
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob') continue;
      e.dead = true;
      e.hp = 0;
      e.aiState = 'dead';
      e.respawnTimer = 9999;
      e.corpseTimer = 9999;
      e.inCombat = false;
    }

    // Negative control: the mark is absent before the harvest, so the read
    // below cannot pass off a pre-seeded set as a producer write.
    expect(meta.deedStats.visited.has(MARK), 'the mark must not pre-exist').toBe(false);
    expect(sim.harvestNode(node.id, undefined, pid), 'the gather cast must be granted').toBe(true);
    for (let i = 0; i < 80 && p.castingAbility; i++) sim.tick();
    expect(p.castingAbility, 'the gather cast must finish inside the drive').toBeNull();
    // The grant really landed: the mark writes only on the granted path, so
    // without this a silent denial would read as a template rename.
    const material = NODE_MATERIAL_TABLE[node.type][node.zoneId];
    const grade = MATERIAL_GRADES[material.itemId];
    expect(grade, `${material.itemId} needs a fine-grade row`).toBeDefined();
    expect(
      sim.countItem(material.itemId, pid) + sim.countItem(grade.fineItemId, pid),
      `${node.id} granted no ${material.itemId} of either grade`,
    ).toBeGreaterThanOrEqual(1);
    // The literal, straight off the producer's own write.
    expect(meta.deedStats.visited.has(MARK), 'the producer must write MARK').toBe(true);
  });

  it('the wiki renders every complete zone in each land gathering table', () => {
    // Non-vacuity first: the generated guide really carries node tables for
    // the three land professions, or the per-zone loop below never runs.
    const withNodes = GUIDE_PROF_GATHERING.filter((guide) => guide.nodes?.length);
    expect(withNodes.length).toBeGreaterThanOrEqual(3);
    for (const zoneId of complete) {
      const zoneName = zoneOf(zoneId).name;
      for (const guide of withNodes) {
        expect(
          guide.nodes?.some((row) => row.zone === zoneName),
          `${zoneName} missing from a wiki gathering table`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// THE FARMING LADDER (Phase 5): farming is the fifth gathering profession and
// deliberately fishing-shaped on land (D2): no GatherNodeType, no vendor
// stocking until Phase 9, and its own zone tier column. Every arm below is
// keyed to the FARMING_ZONE_TIERS literal set, never derived from
// GATHER_NODES (deviation (j)): the farming column intentionally disagrees
// with the ground at evergarden, so a node-derived expectation would either
// red on the designed row or force the design to follow the ground (the
// farming_zones.ts header). The one-ladder agreement arm (FARM_PATCHES[].tier
// equals farmingZoneTierFor) already lives in
// tests/farm_patch_placement.test.ts; these arms own the content-completeness
// half, the way the new-zone checklist above owns it for 'complete' zones.
// ---------------------------------------------------------------------------

describe('the farming ladder: every farming zone arrives mechanically whole', () => {
  const farmingTools = Object.entries(ITEMS).filter(
    ([, def]) => def.use?.type === 'gatherTool' && def.use.professionId === 'farming',
  );

  it('every farming zone has exactly one patch at its literal tier with its pinned bed count', () => {
    // The tier column itself, as LITERALS: the column's authority is a design
    // decision (evergarden is farming tier 4 while the shipped progression
    // still says 1), so no derivation can stand in for these numbers. This
    // pin is also the non-vacuity proof for every loop below that walks
    // FARMING_ZONE_TIERS.
    expect(FARMING_ZONE_TIERS).toEqual({
      eastbrook_vale: 1,
      mirefen_marsh: 2,
      thornpeak_heights: 3,
      evergarden: 4,
    });
    // Bed counts are tier-scaled and PERSISTED save-key surface (bed ids), so
    // they are pinned per zone as literals, never summed.
    const BEDS_BY_ZONE: Readonly<Record<string, number>> = {
      eastbrook_vale: 4,
      mirefen_marsh: 5,
      thornpeak_heights: 6,
      evergarden: 8,
    };
    for (const [zoneId, tier] of Object.entries(FARMING_ZONE_TIERS)) {
      const patches = FARM_PATCHES.filter((p) => p.zoneId === zoneId);
      expect(patches, `${zoneId} needs exactly one farm patch`).toHaveLength(1);
      expect(patches[0].tier, `${zoneId} patch tier must be the ladder literal`).toBe(tier);
      expect(patches[0].beds, `${zoneId} bed count`).toHaveLength(BEDS_BY_ZONE[zoneId]);
    }
    // The counter-example for the per-zone filter: the four rows above are
    // the WHOLE patch table, so a fifth site cannot ship outside the ladder
    // and leave every loop above green.
    expect(FARM_PATCHES).toHaveLength(4);
  });

  it('each farming tier grows exactly its two D11 crops', () => {
    const CROPS_BY_TIER: Readonly<Record<number, readonly string[]>> = {
      1: ['brook_carrot', 'vale_wheat'],
      2: ['bog_beet', 'marsh_rice'],
      3: ['frost_gourd', 'highland_barley'],
      4: ['evergarden_greens', 'gilded_sunmelon'],
    };
    for (const tier of Object.values(FARMING_ZONE_TIERS)) {
      const ofTier = Object.values(FARM_CROPS)
        .filter((c) => c.tier === tier)
        .map((c) => c.id)
        .sort();
      expect(ofTier, `tier ${tier} crop pair (D11)`).toEqual([...CROPS_BY_TIER[tier]]);
    }
    // The four pairs are the whole catalog: a ninth crop cannot ship without
    // joining a pair above, and a dropped crop cannot hide behind the pairs
    // that remain.
    expect(Object.keys(FARM_CROPS)).toHaveLength(8);
  });

  it('every crop family is whole: defs, junk produce, the 2x/4x fine pricing, icon and name rows', () => {
    const enNames = itemNames.en.entities.items as Record<string, { name?: string } | undefined>;
    const recipesSeen = new Map<string, string>();
    for (const crop of Object.values(FARM_CROPS)) {
      const produce = ITEMS[crop.produceItemId];
      const fine = ITEMS[crop.fineProduceItemId];
      expect(ITEMS[crop.seedItemId], `${crop.id} seed def`).toBeDefined();
      expect(produce, `${crop.id} produce def`).toBeDefined();
      expect(fine, `${crop.id} fine def`).toBeDefined();
      // kind junk so produce browses under the market's material filter and
      // sellAllJunk never vendors it (the node materials' convention).
      expect(produce.kind, `${crop.id} produce kind`).toBe('junk');
      // The fine twin's whole reward is doubling the sell price, and its
      // buyValue is the 4x ECONOMY BASIS the recipe_economy counterfactual
      // reads, never a stock row (the fine-material convention in items.ts).
      expect(fine.sellValue, `${crop.id} fine sell must be 2x produce sell`).toBe(
        (produce.sellValue ?? 0) * 2,
      );
      expect(fine.buyValue, `${crop.id} fine buy must be the 4x economy basis`).toBe(
        (fine.sellValue ?? 0) * 4,
      );
      // Seed/produce disjointness: an aliased id would let one bag stack
      // answer both the seed gate and the watch-fee gate (farm_watch_fee.ts).
      expect(crop.seedItemId, `${crop.id} seed must not alias its produce`).not.toBe(
        crop.produceItemId,
      );
      expect(crop.seedItemId, `${crop.id} seed must not alias its fine twin`).not.toBe(
        crop.fineProduceItemId,
      );
      for (const itemId of [crop.seedItemId, crop.produceItemId, crop.fineProduceItemId]) {
        // The icon registry, probed the way tests/item_icons.test.ts does:
        // never the shared unknown fallback, and pairwise DISTINCT below,
        // which is what proves an explicit ITEM_RECIPES row (all 24 ids are
        // kind junk, so the kind-default fallback would collide them).
        const recipe = itemIconRecipe(itemId);
        expect(isUnknownIconRecipe(recipe), `${itemId} must resolve a real icon recipe`).toBe(
          false,
        );
        const key = JSON.stringify(recipe);
        const clash = recipesSeen.get(key);
        expect(clash, `${itemId} must not share its whole icon recipe with ${clash}`).toBe(
          undefined,
        );
        recipesSeen.set(key, itemId);
        expect(enNames[itemId]?.name, `${itemId} needs an English item-name row`).toBeTruthy();
      }
    }
    // The two probes really discriminate: an unshipped id resolves the shared
    // unknown recipe and no name row, so the loop above cannot pass vacuously.
    expect(isUnknownIconRecipe(itemIconRecipe('no_such_farming_item'))).toBe(true);
    expect(enNames.no_such_farming_item).toBeUndefined();
  });

  it('tier 1 and 2 seeds are vendor-priced, tier 3 and 4 seeds never (both directions)', () => {
    // Literal id lists on both sides (the locked pricing table): dormant by
    // choice until Phase 9 stocks the priced four, drop-and-market supply
    // only for the high four.
    const PRICED_SEEDS = [
      'bog_beet_seed',
      'brook_carrot_seed',
      'marsh_rice_seed',
      'vale_wheat_seed',
    ];
    const UNPRICED_SEEDS = [
      'evergarden_greens_seed',
      'frost_gourd_seed',
      'gilded_sunmelon_seed',
      'highland_barley_seed',
    ];
    // The two lists really partition the catalog's whole seed column, so
    // neither loop below can pass over a seed the lists forgot.
    expect([...PRICED_SEEDS, ...UNPRICED_SEEDS].sort()).toEqual(
      Object.values(FARM_CROPS)
        .map((c) => c.seedItemId)
        .sort(),
    );
    for (const itemId of PRICED_SEEDS) {
      expect(ITEMS[itemId]?.buyValue ?? 0, `${itemId} needs a positive buyValue`).toBeGreaterThan(
        0,
      );
    }
    for (const itemId of UNPRICED_SEEDS) {
      expect(ITEMS[itemId]?.buyValue, `${itemId} must never be vendor-obtainable`).toBe(undefined);
    }
  });

  it('brook_carrot is the one vendor-priced produce (D9), and no other family row leaks pricing', () => {
    // The D9 fee vegetable: priced so the watch fee is payable from vendor
    // stock before a first harvest.
    expect(ITEMS.brook_carrot?.buyValue).toBe(16);
    let produceSwept = 0;
    for (const crop of Object.values(FARM_CROPS)) {
      if (crop.produceItemId !== 'brook_carrot') {
        produceSwept += 1;
        expect(
          ITEMS[crop.produceItemId]?.buyValue,
          `${crop.produceItemId} produce must carry no vendor price`,
        ).toBe(undefined);
      }
      if (crop.tier >= 3) {
        expect(
          ITEMS[crop.seedItemId]?.buyValue,
          `${crop.seedItemId} is a tier ${crop.tier} seed and must carry no vendor price`,
        ).toBe(undefined);
      }
    }
    // Seven produce rows really swept, so the exception loop was not vacuous.
    expect(produceSwept).toBe(7);
    // The D9 exception is scoped to brook_carrot ALONE within its own tier-1
    // family: vale_wheat is the other tier-1 produce and carries none.
    expect(
      Object.values(FARM_CROPS)
        .filter((c) => c.tier === 1)
        .map((c) => c.produceItemId)
        .sort(),
    ).toEqual(['brook_carrot', 'vale_wheat']);
    expect(ITEMS.vale_wheat?.buyValue).toBe(undefined);
  });

  it('exactly one hoe per tier; rung 1 is the only priced rung and the top rung routes through content', () => {
    // Non-vacuity for the per-tier loop: the ladder really has four members.
    expect(farmingTools).toHaveLength(4);
    for (const tier of Object.values(FARMING_ZONE_TIERS)) {
      const ofTier = farmingTools.filter(
        ([, def]) => def.use?.type === 'gatherTool' && def.use.tier === tier,
      );
      expect(ofTier, `exactly one farming hoe at tier ${tier}`).toHaveLength(1);
      const [itemId, def] = ofTier[0];
      if (tier === 1) {
        expect(def.buyValue ?? 0, `${itemId} is the one vendor-priced rung`).toBeGreaterThan(0);
      } else {
        // Rungs 2 to 4 are craft-only (HOE_RECIPES), the top rung included:
        // the R23 shape, no copper price anywhere above the entry rung.
        expect(def.buyValue, `${itemId} must never price for copper`).toBe(undefined);
        expect(
          HOE_RECIPES.some((recipe) => recipe.resultItemId === itemId),
          `${itemId} needs its HOE_RECIPES mint`,
        ).toBe(true);
      }
    }
    // The four qualities as LITERALS (the Phase 5 QA add): rung quality
    // feeds the charm-charge economy twice, through the R47 use-time ratchet
    // (startingDurabilityFor prices per rarity rung) and the R30 recharge
    // rarity resolution, so a silent quality edit re-prices charges with
    // nothing else red. The step function is deliberate: tiers 1 and 2 are
    // both common, matching every other land ladder.
    expect(Object.fromEntries(farmingTools.map(([itemId, def]) => [itemId, def.quality]))).toEqual({
      garden_hoe: 'common',
      bronze_hoe: 'common',
      skysilver_hoe: 'uncommon',
      osmium_hoe: 'rare',
    });
  });

  it('every farming material is consumed by a live path: the Phase 6 closure', () => {
    // THE LOOP IS CLOSED. Two halves of live demand together account for every
    // farming material, with no deferred-note escape hatch left anywhere.
    // COMMANDS: plant_crop spends every seed, the watch fee is a produce sink,
    // convert_husks eats husks, and the plant-time knobs consume the two
    // supplies. RECIPES: the whole MERGED ALL_RECIPES reagent set, which
    // subsumes HOE_RECIPES (the three hoe fine twins) and the Phase 6
    // FARM_RECIPES (the eight dishes' produce plus the five remaining fine
    // twins). The recipe term is deliberately filtered to NO subset: a
    // farming material earns its keep through demand wherever the demand
    // lives, so a future craft outside cooking counts the same.
    //
    // The exact-set pin on FARM_MATERIAL_ITEM_IDS in
    // tests/material_taxonomy.test.ts is still the smuggle guard: it is what
    // stops a material being quietly dropped from the taxonomy to make this
    // arm green, so the two suites have to be edited together to fake a pass.
    const recipeConsumed = new Set<string>(
      ALL_RECIPES.flatMap((recipe) => recipe.reagents.map((reagent) => reagent.itemId)),
    );
    const liveConsumed = new Set<string>([
      ...Object.values(FARM_CROPS).flatMap((c) => [c.seedItemId, c.produceItemId]),
      FARM_WITHERED_HUSK_ITEM_ID,
      ...FARM_SUPPLY_ITEM_IDS,
      ...recipeConsumed,
    ]);
    const unaccounted = FARM_MATERIAL_ITEM_IDS.filter((itemId) => !liveConsumed.has(itemId));
    expect(unaccounted, 'every farming material needs a live consumer').toEqual([]);
    // Non-vacuity, both terms: the taxonomy really carries all 27 materials
    // and each one is covered, and the RECIPE half alone is non-empty, so a
    // broken import or an emptied FARM_RECIPES cannot leave the command terms
    // silently carrying the whole arm.
    expect(FARM_MATERIAL_ITEM_IDS.length).toBe(27);
    expect(FARM_MATERIAL_ITEM_IDS.every((itemId) => liveConsumed.has(itemId))).toBe(true);
    expect(
      FARM_MATERIAL_ITEM_IDS.filter((itemId) => recipeConsumed.has(itemId)).length,
      'the recipe-derived term must consume farming materials on its own',
    ).toBeGreaterThan(0);
    // THE CLOSURE DIRECTION, as LITERALS: these five fine twins are exactly
    // the Phase 5 deferral (the ladder took three twins and left five with no
    // consumer, noted then as "the dishes phase"), and Phase 6 closed it with
    // one dedicated dish slot each. A literal twin -> recipe map, never a
    // derivation: the deferral closed against these five NAMED recipes, so a
    // dish that quietly drops its twin, or a swap of which dish carries which
    // twin, reds here instead of passing on a count.
    const CLOSED_PHASE5_DEFERRALS: Readonly<Record<string, string>> = {
      fine_bog_beet: 'recipe_fenbridge_beet_braise',
      fine_brook_carrot: 'recipe_eastbrook_root_pottage',
      fine_evergarden_greens: 'recipe_evergarden_harvest_platter',
      fine_frost_gourd: 'recipe_highwatch_gourd_soup',
      fine_gilded_sunmelon: 'recipe_evergarden_sunmelon_tart',
    };
    for (const [twin, recipeId] of Object.entries(CLOSED_PHASE5_DEFERRALS)) {
      const consumers = ALL_RECIPES.filter((recipe) =>
        recipe.reagents.some((reagent) => reagent.itemId === twin),
      ).map((recipe) => recipe.id);
      expect(
        consumers.length,
        `${twin} lost its live recipe consumer; the Phase 5 deferral reopened`,
      ).toBeGreaterThanOrEqual(1);
      expect(consumers, `${twin} must be consumed by ${recipeId}`).toContain(recipeId);
      expect(
        FARM_MATERIAL_ITEM_IDS.includes(twin),
        `${twin} is mapped here but is not a farming material`,
      ).toBe(true);
    }
    // The OTHER twin family stays disjointly accounted, so neither family is
    // standing in for the other's coverage: the three hoe twins keep their
    // HOE_RECIPES consumers (deviation (ad), each crafted rung consuming the
    // twin one tier below it). These three gained no dish in Phase 6 and were
    // never part of the deferral.
    const HOE_TWIN_CONSUMERS: Readonly<Record<string, string>> = {
      fine_highland_barley: 'recipe_osmium_hoe',
      fine_marsh_rice: 'recipe_skysilver_hoe',
      fine_vale_wheat: 'recipe_bronze_hoe',
    };
    for (const [twin, recipeId] of Object.entries(HOE_TWIN_CONSUMERS)) {
      expect(
        HOE_RECIPES.some(
          (recipe) =>
            recipe.id === recipeId && recipe.reagents.some((reagent) => reagent.itemId === twin),
        ),
        `${twin} must keep its ${recipeId} hoe-recipe consumer`,
      ).toBe(true);
      expect(
        Object.keys(CLOSED_PHASE5_DEFERRALS).includes(twin),
        `${twin} is a hoe twin and must never join the dish deferral map`,
      ).toBe(false);
    }
  });

  it('no NPC vendors any farming item: stocking is dormant by choice until Phase 9', () => {
    // THE DORMANT ARM the hub-rule narrowing above leans on. The Phase 9
    // go-live stocks the farmer NPCs (seeds, compost, the garden hoe); until
    // that phase no vendorItems list anywhere may name a farming item, so a
    // premature stocking row reds HERE rather than sliding through the
    // narrowed hub sweep.
    const farmingItemIds = new Set<string>([
      ...FARM_MATERIAL_ITEM_IDS,
      ...farmingTools.map(([itemId]) => itemId),
    ]);
    // 27 materials plus the four hoes: the sweep's needle set is real.
    expect(farmingItemIds.size).toBe(31);
    let vendorRowsSeen = 0;
    for (const [npcId, npc] of Object.entries(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        vendorRowsSeen += 1;
        expect(
          farmingItemIds.has(itemId),
          `${npcId} vendors farming item ${itemId} before the Phase 9 go-live`,
        ).toBe(false);
      }
    }
    // The counter-example: the walk really saw the world's counters (a
    // non-farming vendor row exists somewhere), so the absence above is a
    // real sweep rather than an empty loop.
    expect(vendorRowsSeen).toBeGreaterThan(0);
    // The two NON-NPC purchase counters (the Marks route) are acquisition
    // surfaces too: a heroic or delve row naming a farming item would open a
    // faucet this arm's NPC walk cannot see. Same dormancy claim, same
    // per-table non-vacuity as the tools sweep above.
    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    for (const offer of HEROIC_VENDOR_STOCK) {
      expect(
        farmingItemIds.has(offer.itemId),
        `heroic vendor stocks farming item ${offer.itemId} before the Phase 9 go-live`,
      ).toBe(false);
    }
    let delveRowsSeen = 0;
    for (const [delveId, entries] of Object.entries(DELVE_SHOPS)) {
      for (const entry of entries) {
        delveRowsSeen += 1;
        expect(
          farmingItemIds.has(entry.itemId),
          `${delveId} delve shop stocks farming item ${entry.itemId} before the Phase 9 go-live`,
        ).toBe(false);
      }
    }
    expect(delveRowsSeen).toBeGreaterThan(0);
  });

  it('no Phase 6 farm recipe is craftable from vendor stock alone before the Phase 9 go-live', () => {
    // THE DORMANCY NEGATIVE the arm above implies but does not cover. Dormant
    // STOCKING is only half the go-live guarantee: a farm recipe whose WHOLE
    // reagent list can be bought off a counter would be live today, farm or no
    // farm, and would mint its output (and its cooking skill-ups) years before
    // the patches open. So every FARM_RECIPES row must keep at least one
    // reagent no live NPC stocks. For the eight dishes that reagent is farm
    // produce, which nobody can grow before the go-live phase; for the tonic it
    // is silverleaf_herb, wild-gathered and priceless by doctrine.
    //
    // DELIBERATE and ledgered as deviation (ai): the tonic IS craftable
    // pre-go-live by a player who gathers the herbs. That is exactly D7's
    // cross-profession trade, whose faucet is the herb line rather than the
    // farm, so this arm asserts unstocked-ness, never uncraftability.
    // The stocked universe is EVERY purchase surface, not just NPC counters:
    // the heroic vendor and the delve shops sell for Marks with no buyValue
    // and no vendorItems row, so a farm reagent (or a dish) stocked there
    // would keep both price-basis arms green while breaking the live-surface
    // guarantee. Union all three so one future faucet channel cannot hide.
    const stockedItemIds = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) stockedItemIds.add(itemId);
    }
    for (const offer of HEROIC_VENDOR_STOCK) stockedItemIds.add(offer.itemId);
    for (const entries of Object.values(DELVE_SHOPS)) {
      for (const entry of entries) stockedItemIds.add(entry.itemId);
    }
    // Same non-vacuity as the arm above: the world really has counters, so an
    // "unstocked" verdict below is a real absence rather than an empty walk.
    expect(stockedItemIds.size).toBeGreaterThan(0);
    // The whole Phase 6 set really swept: eight dishes plus the tonic.
    expect(FARM_RECIPES).toHaveLength(9);
    for (const recipe of FARM_RECIPES) {
      expect(recipe.reagents.length, `${recipe.id} needs reagents to sweep`).toBeGreaterThan(0);
      const unstocked = recipe.reagents
        .map((reagent) => reagent.itemId)
        .filter((itemId) => !stockedItemIds.has(itemId));
      expect(
        unstocked.length,
        `${recipe.id} is craftable from vendor stock alone: every reagent sits on a counter`,
      ).toBeGreaterThan(0);
      // The stronger PRICE-BASIS arm, pinned here at the source: a row whose
      // reagents ALL carry a copper buyValue joins the vendor-fed
      // counterfactual in tests/recipe_economy.test.ts (a sorted literal pin
      // plus a discounted-input bound), so a farm row drifting into that shape
      // is both a dormancy break and a cross-suite break.
      // Every reagent id must resolve BEFORE the priceless filter reads it: a
      // typo'd id would satisfy `?.buyValue === undefined` vacuously and read
      // as "priceless" instead of failing.
      for (const reagent of recipe.reagents) {
        expect(
          ITEMS[reagent.itemId],
          `${recipe.id} reagent ${reagent.itemId} does not resolve in the merged catalog`,
        ).toBeDefined();
      }
      const priceless = recipe.reagents
        .map((reagent) => reagent.itemId)
        .filter((itemId) => ITEMS[itemId]?.buyValue === undefined);
      expect(
        priceless.length,
        `${recipe.id} needs at least one reagent with no vendor buy price`,
      ).toBeGreaterThan(0);
      // The symmetric OUTPUT arm: no NPC may stock a farm dish or the tonic
      // either (the farming-item arm above cannot see them: dishes are kind
      // food, outside FARM_MATERIAL_ITEM_IDS). buyValue undefined already
      // makes a stock row render-and-refuse, but the honest claim is that no
      // row exists at all before the Phase 9 go-live.
      expect(
        stockedItemIds.has(recipe.resultItemId),
        `an NPC stocks ${recipe.resultItemId} before the Phase 9 go-live`,
      ).toBe(false);
    }
  });
});
