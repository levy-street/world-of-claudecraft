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
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { GATHERING_PROFESSIONS, STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ZONE1_NPCS } from '../src/sim/content/zone1';
import { ZONE2_NPCS } from '../src/sim/content/zone2';
import { ZONE3_NPCS } from '../src/sim/content/zone3';
import { GATHER_NODE_TYPES, GATHER_NODES, ITEMS, NPCS, ZONES } from '../src/sim/data';
import { ZONE_FISH } from '../src/sim/deeds';
import { FISHING_ZONE_ROD_TIERS } from '../src/sim/professions/fishing_zones';
import {
  gatherNodeGainMultiplier,
  NODE_HARVEST_TABLE,
  NODE_MATERIAL_TABLE,
} from '../src/sim/professions/gathering';
import { MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { wieldRequirementForTier } from '../src/sim/professions/wield_gate';
import { Sim } from '../src/sim/sim';
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
      for (const [itemId, def] of landTools) {
        if (def.use?.type !== 'gatherTool') continue;
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
