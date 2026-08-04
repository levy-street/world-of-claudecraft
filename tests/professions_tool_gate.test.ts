// The land-tool wield gate (R22) and its advisory surfaces: the wield table
// and resolvers (src/sim/professions/wield_gate.ts), the harvest-boundary
// refusal that owns enforcement, the OPEN counter (the old authoritative buy
// deny is retired; a sale is never refused for proficiency), and the advisory
// requirement rows in the vendor view core (content/vendor_row_gates.ts,
// whose numbers alias the wield table).
//
// The suite's centrepiece is the DERIVED-CEILING family: it recomputes, from
// the live gain constants rather than copied numbers, the proficiency at
// which each node tier stops teaching, and asserts the knife-edge rule for
// every wield threshold: each requirement is reachable on ground the
// previous tier's tool can already work. The first zone is all tier-1 ground
// and the gather quests grant only the tier-1 tool, so a tier-2/3 threshold
// at or above the tier-1 ceiling would dead-end the ladder with no test
// failing; tier-4/5 lean on tier-2+ ground, which teaches to the cap.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSIONS, type GatheringProfessionId } from '../src/sim/content/professions';
import {
  resolveVendorRowGate,
  TIER2_TOOL_GATE_PROFICIENCY,
  TIER3_TOOL_GATE_PROFICIENCY,
  VENDOR_ROW_GATES,
} from '../src/sim/content/vendor_row_gates';
import { GATHER_NODES, ITEMS, NPCS, zoneAt } from '../src/sim/data';
import * as items from '../src/sim/items';
import {
  GATHER_GAIN_TIER_STEP,
  gatherNodeGainMultiplier,
  harvestYieldItemId,
} from '../src/sim/professions/gathering';
import {
  bestWieldableAnyGatherToolTier,
  bestWieldableGatherToolTierOrNone,
  canWieldGatherToolTier,
  minWieldRequirementToWork,
  minWieldRequirementToWorkAny,
  TIER2_TOOL_WIELD_PROFICIENCY,
  TIER3_TOOL_WIELD_PROFICIENCY,
  TIER4_TOOL_WIELD_PROFICIENCY,
  TIER5_TOOL_WIELD_PROFICIENCY,
  WIELD_REQUIREMENT_BY_TIER,
  wieldRequirementForTier,
} from '../src/sim/professions/wield_gate';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, INTERACT_RANGE, type SimEvent } from '../src/sim/types';
import { buildVendorView } from '../src/ui/hud/vendor/vendor_view';
import { NPC_WINDOW_CLOSE_RANGE } from '../src/ui/npc_service_range';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

// A warrior standing at the Fenbridge provisioner, the zone-2 hub that stocks
// the tier-2 land tools once Eastbrook stops over-stocking them. Bags emptied so
// the counts below are absolute.
function shopper(sim: Sim) {
  const anySim = sim as unknown as {
    entities: Map<number, Entity>;
    players: Map<number, { copper: number; inventory: { itemId: string; count: number }[] }>;
    rebucket(e: Entity): void;
  };
  const pid = sim.addPlayer('warrior', 'Prospector');
  const hale = [...anySim.entities.values()].find(
    (e) => (e as unknown as { templateId?: string }).templateId === 'provisioner_hale',
  ) as Entity;
  const p = anySim.entities.get(pid) as Entity;
  p.pos.x = hale.pos.x + 2;
  p.pos.z = hale.pos.z;
  anySim.rebucket(p);
  const meta = sim.meta(pid)!;
  meta.inventory.length = 0;
  meta.copper = 1_000_000;
  return { pid, hale, meta };
}

describe('vendor row gate resolver', () => {
  it('leaves an ungated row open regardless of proficiency, and reports no requirement', () => {
    // The tier-1 tool the gather quests grant: it must never carry a gate,
    // because the #2343 rule makes it mandatory for any harvest at all.
    expect(resolveVendorRowGate('copper_mining_pick', {})).toEqual({ locked: false });
    expect(resolveVendorRowGate('baked_bread', { mining: 0 })).toEqual({ locked: false });
  });

  it('locks a gated row below its threshold and opens it exactly at the threshold', () => {
    const below = resolveVendorRowGate('iron_mining_pick', {
      mining: TIER2_TOOL_GATE_PROFICIENCY - 1,
    });
    expect(below.locked).toBe(true);
    expect(below.requirement).toEqual({
      professionId: 'mining',
      proficiency: TIER2_TOOL_GATE_PROFICIENCY,
    });

    // At-or-above, so the boundary point itself opens the row.
    expect(
      resolveVendorRowGate('iron_mining_pick', { mining: TIER2_TOOL_GATE_PROFICIENCY }).locked,
    ).toBe(false);
    expect(
      resolveVendorRowGate('iron_mining_pick', { mining: TIER2_TOOL_GATE_PROFICIENCY + 1 }).locked,
    ).toBe(false);
  });

  it('reads a missing or untracked profession as 0, which LOCKS rather than opens', () => {
    // The safe direction: a caller that hands over an incomplete map
    // under-promises instead of offering a purchase the sim would refuse.
    expect(resolveVendorRowGate('mithril_mining_pick', {}).locked).toBe(true);
    expect(resolveVendorRowGate('mithril_mining_pick', { logging: 100 }).locked).toBe(true);
    // A gated row still reports its requirement when locked by absence.
    expect(resolveVendorRowGate('mithril_mining_pick', {}).requirement?.proficiency).toBe(
      TIER3_TOOL_GATE_PROFICIENCY,
    );
  });

  it('treats a MALFORMED proficiency value as 0, which locks, exactly like an absent one', () => {
    // A bare `held < threshold` comparison lets NaN through: NaN < 40 is false,
    // so the row would OPEN. The sim's own map is sanitized on load, but the
    // online client mirrors gprof straight off the wire with no shape check and
    // hands that map to the view, so this is the one direction the resolver
    // must not fail open in.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '99', {}]) {
      const map = { mining: bad } as unknown as Record<string, number>;
      expect(resolveVendorRowGate('iron_mining_pick', map).locked, String(bad)).toBe(true);
    }
    // Of the values above, NaN / +Infinity / '99' / {} are the ones that
    // DISCRIMINATE: each opens the row under a bare `held < threshold` and
    // locks it under the shipped coercion. undefined and null pass either way
    // and are carried by the absent-value case above, so they are breadth, not
    // the guard. A -Infinity arm was dropped for exactly that reason: it locks
    // under both, so it proved nothing while reading like a second check.
  });

  it('never resolves a prototype key as a gate', () => {
    // The table is an object literal, so a bare lookup answers `constructor`
    // and friends with a truthy non-gate. A custom world document can put an
    // arbitrary string into an NPC's vendorItems, so the ids reaching this
    // resolver are not all content-authored.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(resolveVendorRowGate(key, {}), key).toEqual({ locked: false });
    }
  });

  it('the gate table and every row are actually frozen, not just Readonly-typed', () => {
    // The freeze is the runtime half of the two-world desync argument the
    // module comment makes: a mutated row would change buy denials on one
    // host only. Dropping the Object.freeze calls must redden here.
    expect(Object.isFrozen(VENDOR_ROW_GATES)).toBe(true);
    const rows = Object.values(VENDOR_ROW_GATES);
    expect(rows.length).toBeGreaterThan(0); // non-vacuity
    for (const row of rows) {
      expect(Object.isFrozen(row)).toBe(true);
    }
  });

  it('gates each tool on its OWN profession, never on another counter', () => {
    // Capped mining opens no axe and no sickle: three separate ladders.
    for (const itemId of ['felling_axe', 'ironbark_axe', 'bronze_sickle', 'silverleaf_sickle']) {
      expect(resolveVendorRowGate(itemId, { mining: 100 }).locked, itemId).toBe(true);
    }
    expect(resolveVendorRowGate('felling_axe', { logging: 100 }).locked).toBe(false);
    expect(resolveVendorRowGate('bronze_sickle', { herbalism: 100 }).locked).toBe(false);
  });
});

describe('the threshold values themselves', () => {
  it('are 40, 70, 85 and 100, pinned as literals', () => {
    // Everything else in this file compares the constants to THEMSELVES, which
    // proves the wiring and proves nothing about the numbers: a mutation to
    // 45 / 65 keeps most of the suite green while staying under the ceiling
    // and inside the margin. These numbers are published player copy (the
    // wiki tools note interpolates them, tooltips and vendor rows render
    // them), so a rebalance has to touch this claim rather than drift past
    // it. Same reasoning and shape as the tier-1 price pin in
    // tests/professions_tools.test.ts.
    expect(TIER2_TOOL_WIELD_PROFICIENCY).toBe(40);
    expect(TIER3_TOOL_WIELD_PROFICIENCY).toBe(70);
    expect(TIER4_TOOL_WIELD_PROFICIENCY).toBe(85);
    expect(TIER5_TOOL_WIELD_PROFICIENCY).toBe(100);
    // The whole ladder, as the one frozen table every surface reads.
    expect(WIELD_REQUIREMENT_BY_TIER).toEqual({ 1: 0, 2: 40, 3: 70, 4: 85, 5: 100 });
    expect(Object.isFrozen(WIELD_REQUIREMENT_BY_TIER)).toBe(true);
    // The vendor's advisory constants ALIAS the wield table rather than
    // keeping numbers of their own; a fork here is the two-surfaces drift the
    // advisory model exists to prevent.
    expect(TIER2_TOOL_GATE_PROFICIENCY).toBe(TIER2_TOOL_WIELD_PROFICIENCY);
    expect(TIER3_TOOL_GATE_PROFICIENCY).toBe(TIER3_TOOL_WIELD_PROFICIENCY);
  });
});

describe('the wield resolvers (professions/wield_gate.ts)', () => {
  const inv = (...ids: string[]) => ids.map((itemId) => ({ itemId, count: 1 }));

  it('wieldRequirementForTier reads the table, 0 for tier 1 and anything unshipped', () => {
    expect(wieldRequirementForTier(1)).toBe(0);
    expect(wieldRequirementForTier(2)).toBe(TIER2_TOOL_WIELD_PROFICIENCY);
    expect(wieldRequirementForTier(5)).toBe(TIER5_TOOL_WIELD_PROFICIENCY);
    // Fail OPEN toward pre-R22 behavior for a tier outside the ladder: an
    // unknown tier must not brick a tool.
    expect(wieldRequirementForTier(6)).toBe(0);
    expect(wieldRequirementForTier(0)).toBe(0);
  });

  it('canWieldGatherToolTier boundaries: below refuses, at and above wield', () => {
    expect(canWieldGatherToolTier(2, TIER2_TOOL_WIELD_PROFICIENCY - 1)).toBe(false);
    expect(canWieldGatherToolTier(2, TIER2_TOOL_WIELD_PROFICIENCY)).toBe(true);
    expect(canWieldGatherToolTier(5, TIER5_TOOL_WIELD_PROFICIENCY)).toBe(true);
    expect(canWieldGatherToolTier(1, 0)).toBe(true);
  });

  it('coerces malformed proficiency to 0, which LOCKS (the resolveVendorRowGate contract)', () => {
    // NaN < threshold is false under a bare comparison, which would WIELD an
    // unearned tool off a malformed wire value; the online mirror assigns
    // gprof with no shape check, so this is the direction that must not fail
    // open. NaN / Infinity / '99' discriminate; undefined rides the same arm.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '99', undefined, null, {}]) {
      expect(canWieldGatherToolTier(2, bad), String(bad)).toBe(false);
    }
  });

  it('the wield-aware scan filters an unwieldable land tool and floors at NO_TOOL', () => {
    // A tier-2 pick at mining 0: owned, not wieldable, so the scan reports
    // nothing usable at all.
    expect(bestWieldableGatherToolTierOrNone(inv('iron_mining_pick'), 'mining', 0, ITEMS)).toBe(0);
    // At the threshold it wields.
    expect(
      bestWieldableGatherToolTierOrNone(
        inv('iron_mining_pick'),
        'mining',
        TIER2_TOOL_WIELD_PROFICIENCY,
        ITEMS,
      ),
    ).toBe(2);
    // A wieldable lower tool beside an unwieldable higher one: the usable one
    // wins, the unearned one is inert rather than poisonous.
    expect(
      bestWieldableGatherToolTierOrNone(
        inv('copper_mining_pick', 'mithril_mining_pick'),
        'mining',
        0,
        ITEMS,
      ),
    ).toBe(1);
  });

  it('rods are exempt structurally: the fishing scan never filters', () => {
    // A tier-3 rod at fishing proficiency 0 contributes its full tier; the
    // exemption is inside the shared resolver, not a caller convention, so a
    // land-side caller cannot accidentally gate a rod.
    expect(
      bestWieldableGatherToolTierOrNone(inv('silverstream_fishing_rod'), 'fishing', 0, ITEMS),
    ).toBe(3);
  });

  it('the any-profession corpse scan filters land tools per counter, rods unfiltered', () => {
    // R50: an unwieldable tier-3 pick contributes nothing, bare hands floor
    // the scan at 1.
    expect(bestWieldableAnyGatherToolTier(inv('mithril_mining_pick'), {}, ITEMS)).toBe(1);
    // The same pick at mining 70 contributes its tier.
    expect(
      bestWieldableAnyGatherToolTier(
        inv('mithril_mining_pick'),
        { mining: TIER3_TOOL_WIELD_PROFICIENCY },
        ITEMS,
      ),
    ).toBe(3);
    // A rod contributes unfiltered at zero proficiency (the R22 exemption).
    expect(bestWieldableAnyGatherToolTier(inv('silverstream_fishing_rod'), {}, ITEMS)).toBe(3);
  });

  it('minWieldRequirementToWork names the smallest threshold that unlocks something CARRIED', () => {
    // Owns tier-2 and tier-3 picks, target tier 2: the tier-2 pick's 40 is
    // the honest number, not the tier-3 pick's 70.
    expect(
      minWieldRequirementToWork(inv('iron_mining_pick', 'mithril_mining_pick'), 'mining', 2, ITEMS),
    ).toBe(TIER2_TOOL_WIELD_PROFICIENCY);
    // Owns ONLY the tier-3 pick, target tier 2: 70 is what unlocks it.
    expect(minWieldRequirementToWork(inv('mithril_mining_pick'), 'mining', 2, ITEMS)).toBe(
      TIER3_TOOL_WIELD_PROFICIENCY,
    );
    // Nothing covering the target: null, the plain no-tool arm's signal.
    expect(minWieldRequirementToWork(inv('copper_mining_pick'), 'mining', 2, ITEMS)).toBe(null);
    expect(minWieldRequirementToWork(inv(), 'mining', 1, ITEMS)).toBe(null);
  });

  it('minWieldRequirementToWorkAny skips fishing: a covering rod never names a requirement', () => {
    // The any-scan would have PASSED with a covering rod (it wields freely),
    // so the corpse denial asking for a requirement can only be about land
    // tools; a rod in the bags must not smuggle a rod "requirement" into it.
    expect(minWieldRequirementToWorkAny(inv('silverstream_fishing_rod'), 3, ITEMS)).toBe(null);
    expect(minWieldRequirementToWorkAny(inv('mithril_mining_pick'), 3, ITEMS)).toBe(
      TIER3_TOOL_WIELD_PROFICIENCY,
    );
  });
});

describe('gate thresholds against the live gain curve', () => {
  // The derived ceiling: the LOWEST proficiency at which a tier-1 node's gain
  // multiplier has fallen to zero, computed by walking the real function rather
  // than restating 75. If the gain curve, the tier step, or the node-tier
  // mapping is ever retuned, this number moves with them and the assertion
  // below is what fails.
  function tier1TeachingCeiling(): number {
    const cap = GATHERING_PROFESSIONS.mining.maxSkill;
    for (let proficiency = 0; proficiency <= cap; proficiency++) {
      if (gatherNodeGainMultiplier(proficiency, 1) === 0) return proficiency;
    }
    return Number.POSITIVE_INFINITY;
  }

  it('the derivation finds a real ceiling inside the cap, and it is where the curve grays out', () => {
    const ceiling = tier1TeachingCeiling();
    // Non-vacuity: a ceiling of Infinity would make the gap assertion below
    // pass for any threshold whatsoever.
    expect(Number.isFinite(ceiling)).toBe(true);
    expect(ceiling).toBeLessThanOrEqual(GATHERING_PROFESSIONS.mining.maxSkill);
    // It really is a boundary: teaching just under it, nothing at it.
    expect(gatherNodeGainMultiplier(ceiling - 1, 1)).toBeGreaterThan(0);
    expect(gatherNodeGainMultiplier(ceiling, 1)).toBe(0);
    // And it is the third gain tier, the shape the curve documents. Stated as
    // the product of the two live constants, not as the literal it evaluates
    // to, so a step change carries this arm with it.
    expect(ceiling).toBe(GATHER_GAIN_TIER_STEP * 3);
  });

  it('every gate threshold sits strictly below the tier-1 teaching ceiling', () => {
    const ceiling = tier1TeachingCeiling();
    for (const [itemId, gate] of Object.entries(VENDOR_ROW_GATES)) {
      expect(gate.proficiency, `${itemId} gate must stay reachable on tier-1 ground`).toBeLessThan(
        ceiling,
      );
    }
    // The margin is the point of picking 70 over the ceiling-hugging 75: name
    // it, so shrinking it to zero is a deliberate edit rather than a drift.
    expect(ceiling - TIER3_TOOL_GATE_PROFICIENCY).toBeGreaterThanOrEqual(5);
    expect(TIER2_TOOL_GATE_PROFICIENCY).toBeLessThan(TIER3_TOOL_GATE_PROFICIENCY);
  });

  // The teaching ceiling of one NODE tier: the lowest proficiency at which
  // its gain multiplier grays out, or the cap when it teaches all the way
  // there (tier-2 ground does: quarter gain from 75 to 100).
  function teachingCeilingFor(nodeTier: number): number {
    const cap = GATHERING_PROFESSIONS.mining.maxSkill;
    for (let proficiency = 0; proficiency <= cap; proficiency++) {
      if (gatherNodeGainMultiplier(proficiency, nodeTier) === 0) return proficiency;
    }
    return cap;
  }

  it('the knife-edge rule holds for the WHOLE wield ladder (R22): every requirement is reachable on the previous tier ground', () => {
    // A tier-t tool's requirement must be reachable by a player whose best
    // wieldable tool is tier t-1: the ground such a player can work is every
    // node tier up to min(t-1, the highest shipped node tier), and the best
    // of that ground's teaching ceilings bounds what they can climb to. A
    // requirement past that ceiling dead-ends the ladder.
    const maxNodeTier = Math.max(...GATHER_NODES.map((n) => n.tier));
    expect(maxNodeTier).toBe(3); // the premise the t4/t5 derivation leans on
    for (const tier of [2, 3, 4, 5]) {
      const req = wieldRequirementForTier(tier);
      expect(req, `tier ${tier} carries a requirement`).toBeGreaterThan(0);
      const ground = Math.min(tier - 1, maxNodeTier);
      const reachable = teachingCeilingFor(ground);
      expect(
        req,
        `tier ${tier} requirement ${req} must be reachable on tier-${ground} ground (ceiling ${reachable})`,
      ).toBeLessThanOrEqual(reachable);
      // Climbability at the boundary: the point just below the requirement
      // still teaches on that ground, so the last step exists.
      expect(gatherNodeGainMultiplier(req - 1, ground)).toBeGreaterThan(0);
    }
    // Margin everywhere the requirement is not AT the cap: tier 5 is the
    // deliberate exception (the masterwork rung asks for the mastered
    // counter itself, and tier-2+ ground teaches to the cap, so the last
    // point is reachable by construction).
    const cap = GATHERING_PROFESSIONS.mining.maxSkill;
    expect(TIER4_TOOL_WIELD_PROFICIENCY).toBeLessThanOrEqual(cap - 5);
    expect(TIER5_TOOL_WIELD_PROFICIENCY).toBe(cap);
    // The ladder is strictly increasing.
    expect(TIER2_TOOL_WIELD_PROFICIENCY).toBeLessThan(TIER3_TOOL_WIELD_PROFICIENCY);
    expect(TIER3_TOOL_WIELD_PROFICIENCY).toBeLessThan(TIER4_TOOL_WIELD_PROFICIENCY);
    expect(TIER4_TOOL_WIELD_PROFICIENCY).toBeLessThan(TIER5_TOOL_WIELD_PROFICIENCY);
  });

  it('the first zone is all tier-1 ground, which is WHY the ceiling bounds the thresholds', () => {
    // The premise the arm above rests on, asserted rather than assumed: if a
    // tier-2 node ever lands in Eastbrook, a player could out-climb tier 1
    // there and the ceiling would stop being the binding constraint.
    const eastbrook = GATHER_NODES.filter((n) => n.zoneId === 'eastbrook_vale');
    expect(eastbrook.length).toBeGreaterThan(0);
    expect([...new Set(eastbrook.map((n) => n.tier))]).toEqual([1]);
  });
});

describe('gate table completeness', () => {
  function landTools(): [string, number][] {
    const out: [string, number][] = [];
    for (const [itemId, def] of Object.entries(ITEMS)) {
      const use = def.use;
      if (use?.type !== 'gatherTool' || use.professionId === 'fishing') continue;
      if (def.buyValue === undefined) continue;
      out.push([itemId, use.tier]);
    }
    return out;
  }

  it('every vendor-priced land tool above tier 1 carries a gate, and tier 1 carries none', () => {
    const tools = landTools();
    for (const [itemId, tier] of tools) {
      const gate = VENDOR_ROW_GATES[itemId];
      if (tier === 1) {
        expect(gate, `${itemId} is the entry tool and must stay ungated`).toBeUndefined();
        continue;
      }
      expect(gate, `${itemId} is a tier-${tier} vendor tool and must carry a gate`).toBeDefined();
      // The threshold is the one for its tier, so the two constants cannot
      // drift apart per item.
      expect(gate?.proficiency, itemId).toBe(
        tier === 2 ? TIER2_TOOL_GATE_PROFICIENCY : TIER3_TOOL_GATE_PROFICIENCY,
      );
      // And on the tool's own profession.
      expect(gate?.professionId, itemId).toBe(
        (ITEMS[itemId].use as { professionId: GatheringProfessionId }).professionId,
      );
    }
    // Non-vacuity, asserted AFTER the loop so a newly added ungated tool is
    // named by its own arm first rather than reported as a bare count change.
    expect(tools.length).toBe(9);
  });

  it('no fishing implement is gated: the water paces the rods, not the counter', () => {
    // SETTLED, where this used to be deferred. Rod access is paced by the
    // water: each zone names the rod tier it takes and refuses a cast without
    // it (professions/fishing_zones.ts), and fishing over your band pays in
    // empty hooks whatever rod you hold. A proficiency gate on the counter on
    // top of that would be a second lock on the same door, and it would put a
    // level-6 fishing quest (q_the_codfather, Mirefen water) behind a
    // proficiency grind for no design gain. Fishing also counts to 200 rather
    // than 100, so the land thresholds would not mean the same thing here.
    const rods = Object.entries(ITEMS).filter(
      ([, def]) => def.use?.type === 'gatherTool' && def.use.professionId === 'fishing',
    );
    expect(rods.length).toBe(4);
    for (const [itemId] of rods) expect(VENDOR_ROW_GATES[itemId], itemId).toBeUndefined();
    expect(VENDOR_ROW_GATES.simple_fishing_pole).toBeUndefined();
    // Split the claim, because the two halves are true for different reasons
    // and a merged count would let one hide behind the other: the two PRICED
    // rods are ungated by ruling, the two crafted ones have no vendor row to
    // gate in the first place.
    const priced = rods.filter(([, def]) => typeof def.buyValue === 'number');
    const crafted = rods.filter(([, def]) => def.buyValue === undefined);
    expect(priced.map(([id]) => id).sort()).toEqual([
      'ironreel_fishing_rod',
      'silverstream_fishing_rod',
    ]);
    expect(crafted.map(([id]) => id).sort()).toEqual([
      'stormreel_fishing_rod',
      'tidewrought_fishing_rod',
    ]);
  });

  it('the gated tools stay transferable, which is what the open-routes note rests on', () => {
    // The scope comment and the design doc both record player-to-player
    // transfer as an OPEN route. That claim is load-bearing (it is the reason
    // the gate is described as purchase-time rather than access-gating), and it
    // rests entirely on the ABSENCE of three flags, which nothing pinned. If a
    // future change adds noMarketList/soulbound/bindOnTrade to these six, that
    // is the maintainer ruling being taken, and this arm is where it surfaces.
    for (const itemId of Object.keys(VENDOR_ROW_GATES)) {
      const def = ITEMS[itemId] as unknown as Record<string, unknown>;
      expect(def.noMarketList, `${itemId} noMarketList`).toBeFalsy();
      expect(def.soulbound, `${itemId} soulbound`).toBeFalsy();
      expect(def.bindOnTrade, `${itemId} bindOnTrade`).toBeFalsy();
      // And sellable, which is what makes the buyback route reachable at all.
      expect(def.noVendorSell, `${itemId} noVendorSell`).toBeFalsy();
    }
  });

  it('gates only ever name a gathering profession that exists', () => {
    for (const [itemId, gate] of Object.entries(VENDOR_ROW_GATES)) {
      // The gated id must be a real land gathering tool. Without this a gate
      // on, say, baked_bread would satisfy every other arm in this file.
      const use = ITEMS[itemId]?.use;
      expect(use?.type, itemId).toBe('gatherTool');
      expect(
        use?.type === 'gatherTool' ? use.professionId : undefined,
        `${itemId} gate profession matches the tool`,
      ).toBe(gate.professionId);
      expect(GATHERING_PROFESSIONS[gate.professionId], itemId).toBeDefined();
      expect(gate.proficiency, itemId).toBeGreaterThan(0);
      expect(gate.proficiency, itemId).toBeLessThanOrEqual(
        GATHERING_PROFESSIONS[gate.professionId].maxSkill,
      );
    }
  });
});

describe('the counter sells ahead; the wield gate owns enforcement (R22)', () => {
  it('SELLS a requirement-carrying tool below its threshold, charging normally', () => {
    // The re-minted purchase-deny pin: the same drive that used to assert a
    // refusal now asserts the open counter. The refusal moved to the harvest
    // boundary, driven in the wield-gate describe below.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, hale, meta } = shopper(sim);
    expect(meta.gatheringProficiency.mining).toBe(0);
    const before = meta.copper;
    sim.drainEvents();

    items.buyItem(ctxOf(sim), hale.id, 'iron_mining_pick', pid);

    expect(sim.countItem('iron_mining_pick', pid)).toBe(1);
    expect(meta.copper).toBe(before - (ITEMS.iron_mining_pick.buyValue ?? 0));
    expect(errorTexts(sim.drainEvents())).toEqual([]);
  });

  it('never emits the retired unlock refusal: the tier-3 row SELLS at the counter that stocks it', () => {
    // The old deny's literal, asserted absent on a drive that actually
    // reaches the purchase: Hale does not stock the tier-3 pick, so the
    // first draft of this arm bounced off 'That item is not sold here.'
    // and passed with the deny fully restored (the vacuous-arm trap).
    // Quartermaster Bree at the Highwatch counter is the row's real home.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const anySim = sim as unknown as { entities: Map<number, Entity>; rebucket(e: Entity): void };
    const pid = sim.addPlayer('warrior', 'Climber');
    const bree = [...anySim.entities.values()].find(
      (e) => (e as unknown as { templateId?: string }).templateId === 'quartermaster_bree',
    ) as Entity;
    expect(bree, 'the Highwatch quartermaster exists').toBeDefined();
    const p = anySim.entities.get(pid) as Entity;
    p.pos.x = bree.pos.x + 2;
    p.pos.z = bree.pos.z;
    anySim.rebucket(p);
    const meta = sim.meta(pid)!;
    meta.inventory.length = 0;
    meta.copper = 1_000_000;
    expect(meta.gatheringProficiency.mining).toBe(0);
    const before = meta.copper;
    sim.drainEvents();

    items.buyItem(ctxOf(sim), bree.id, 'mithril_mining_pick', pid);

    expect(sim.countItem('mithril_mining_pick', pid)).toBe(1);
    expect(meta.copper).toBe(before - (ITEMS.mithril_mining_pick.buyValue ?? 0));
    expect(errorTexts(sim.drainEvents())).toEqual([]);
  });

  it('buyback still works at zero proficiency', () => {
    // Buyback was deliberately ungated even under the purchase-gate model;
    // with the counter open the property is now uniform, and this drive keeps
    // the mastery-reset shape (own, sell, lose the counter, buy back) honest.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, hale, meta } = shopper(sim);
    items.buyItem(ctxOf(sim), hale.id, 'iron_mining_pick', pid);
    expect(sim.countItem('iron_mining_pick', pid)).toBe(1);
    items.sellItem(ctxOf(sim), 'iron_mining_pick', 1, pid);
    expect(sim.countItem('iron_mining_pick', pid)).toBe(0);
    meta.gatheringProficiency.mining = 0;
    sim.drainEvents();

    items.buyBackItem(ctxOf(sim), 'iron_mining_pick', pid);

    expect(sim.countItem('iron_mining_pick', pid)).toBe(1);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
  });

  it('leaves the entry tier-1 tool buyable by a player with no proficiency at all', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, hale, meta } = shopper(sim);
    expect(meta.gatheringProficiency.mining).toBe(0);
    sim.drainEvents();

    items.buyItem(ctxOf(sim), hale.id, 'copper_mining_pick', pid);

    expect(sim.countItem('copper_mining_pick', pid)).toBe(1);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
  });

  it('never confiscates: an unearned tool sits in the bags untouched', () => {
    // The R22 owners-are-never-stripped arm: nothing in the buy path or the
    // wield gate reads-and-removes inventory, so a tier-3 pick held at zero
    // mining stays owned; it is merely inert at the harvest gate until the
    // counter reaches its threshold (driven below).
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, hale, meta } = shopper(sim);
    sim.addItem('mithril_mining_pick', 1, pid);
    sim.drainEvents();

    items.buyItem(ctxOf(sim), hale.id, 'iron_mining_pick', pid);

    expect(sim.countItem('mithril_mining_pick', pid)).toBe(1);
    expect(sim.countItem('iron_mining_pick', pid)).toBe(1);
    expect(meta.gatheringProficiency.mining).toBe(0);
  });
});

describe('the harvest boundary enforces the wield gate (the re-minted deny pins)', () => {
  // A miner standing beside a Copper Dig vein. Placed 1.2yd off the node
  // centre (ore nodes are solid bodies; standing ON one reads blocked) and
  // rebucketed so the spatial grid agrees with the teleport. No ticks run in
  // the deny arms, so no mob can aggro and no cast can be interrupted.
  function miner(sim: Sim, nodeId: string) {
    const node = GATHER_NODES.find((n) => n.id === nodeId);
    if (!node) throw new Error(`missing node ${nodeId}`);
    const anySim = sim as unknown as { rebucket(e: Entity): void };
    const pid = sim.addPlayer('warrior', 'Digger');
    const p = sim.entities.get(pid) as Entity;
    p.pos.x = node.pos.x + 1.2;
    p.pos.z = node.pos.z;
    anySim.rebucket(p);
    const meta = sim.meta(pid)!;
    meta.inventory.length = 0;
    sim.drainEvents();
    return { pid, p, meta, node };
  }

  function denials(events: SimEvent[]) {
    return events.filter(
      (e): e is Extract<SimEvent, { type: 'gatherDenied' }> => e.type === 'gatherDenied',
    );
  }

  it('refuses a covering tool below its wield threshold, naming the counter, drawing nothing', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, p, meta } = miner(sim, 'ore_eastbrook_1');
    sim.addItem('iron_mining_pick', 1, pid);
    expect(meta.gatheringProficiency.mining).toBe(0);
    let draws = 0;
    (sim as unknown as { rng: { setObserver(fn: () => void): void } }).rng.setObserver(() => {
      draws++;
    });

    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(false);

    const denied = denials(sim.drainEvents());
    expect(denied).toHaveLength(1);
    expect(denied[0].surface).toBe('node');
    expect(denied[0].professionId).toBe('mining');
    expect(denied[0].requiredTier).toBe(1);
    // The wield arm: a covering tool IS owned, so the denial names the
    // smallest counter that would put something carried to work.
    expect(denied[0].wieldProficiency).toBe(TIER2_TOOL_WIELD_PROFICIENCY);
    expect(p.castingAbility).toBeFalsy();
    expect(draws).toBe(0);
  });

  it('the boundary: denied at 39, casts at 40 with the same bags', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, p, meta } = miner(sim, 'ore_eastbrook_1');
    sim.addItem('iron_mining_pick', 1, pid);
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY - 1;
    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(false);
    expect(denials(sim.drainEvents())).toHaveLength(1);

    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(true);
    expect(p.castingAbility).toBeTruthy();
    expect(denials(sim.drainEvents())).toHaveLength(0);
  });

  it('the no-tool arm keeps its shape: empty bags deny WITHOUT a wield requirement', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid } = miner(sim, 'ore_eastbrook_1');

    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(false);

    const denied = denials(sim.drainEvents());
    expect(denied).toHaveLength(1);
    expect(denied[0].requiredTier).toBe(1);
    // Absent, not zero: the wield field only rides when a covering tool is
    // actually carried, so the client's no-tool copy keeps its arm.
    expect('wieldProficiency' in denied[0]).toBe(false);
  });

  it('the entry tool works at zero proficiency: tier 1 carries no wield requirement', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, p, meta } = miner(sim, 'ore_eastbrook_1');
    sim.addItem('copper_mining_pick', 1, pid);
    expect(meta.gatheringProficiency.mining).toBe(0);

    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(true);
    expect(p.castingAbility).toBeTruthy();
  });

  it('the GRANT and the cast duration read the wieldable tier too, driven live (R49)', () => {
    // resolveHarvest keeps its OWN scan (the grant must agree with the
    // pre-gates), and the cast duration is a third reader: this drive is the
    // one place all three are distinguished from the OWNERSHIP scan. A
    // wieldable tier-1 pick beside an unwieldable tier-4 pick at mining 0:
    // the cast runs at the tier-1 duration (no speed from a tool you cannot
    // swing), and the grant mints the PLAIN material (a tier-4 read would
    // mint fine_copper_ore at a tier-1 vein). Reverting either read to the
    // ownership scan fails one of the two assertions.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, p, meta } = miner(sim, 'ore_eastbrook_1');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('thorium_mining_pick', 1, pid);
    expect(meta.gatheringProficiency.mining).toBe(0);
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob') continue;
      e.dead = true;
      e.hp = 0;
      e.aiState = 'dead';
      e.respawnTimer = 9999;
      e.corpseTimer = 9999;
      e.inCombat = false;
    }
    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(true);
    // Tier-1 tool at a tier-1 node in band 0: the base 2.5s cast, no
    // tool-tier reduction (a tier-4 read would shave 1.2s).
    expect(p.castTotal).toBeCloseTo(2.5, 5);
    for (let i = 0; i < 80 && p.castingAbility; i++) sim.tick();
    expect(p.castingAbility).toBeFalsy();
    sim.tick();
    expect(sim.countItem('copper_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('fine_copper_ore', pid)).toBe(0);
  });

  it('the shipped land-tool tier set is exactly the wield table (completeness)', () => {
    // A tier-6 tool would read wieldRequirementForTier 0 (fail-open by
    // design) with nothing red; this arm makes shipping one a decision that
    // touches the table.
    const shippedTiers = [
      ...new Set(
        Object.values(ITEMS)
          .filter((def) => def.use?.type === 'gatherTool' && def.use.professionId !== 'fishing')
          .map((def) => (def.use as { tier: number }).tier),
      ),
    ].sort((a, b) => a - b);
    expect(shippedTiers).toEqual([1, 2, 3, 4, 5]);
    expect(
      Object.keys(WIELD_REQUIREMENT_BY_TIER)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(shippedTiers);
  });

  it('the grade arm reads the WIELDABLE tier (R49): an unearned tier-4 pick mints no fine grade', () => {
    // The same resolver the capacity pre-gates and the grant share
    // (effectiveGradeToolTier through harvestYieldItemId), driven pure. At
    // mining 70 the tier-4 pick is owned but not wieldable, so a full-grade
    // tier-3 vein yields the base material; at 85 the same bags mint fine.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const { pid, meta } = miner(sim, 'ore_eastbrook_1');
    sim.addItem('thorium_mining_pick', 1, pid);
    const t3 = GATHER_NODES.find((n) => n.id === 'ore_thornpeak_t3');
    if (!t3) throw new Error('missing ore_thornpeak_t3');
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    expect(harvestYieldItemId(meta, t3)).toBe('thorium_ore');
    meta.gatheringProficiency.mining = TIER4_TOOL_WIELD_PROFICIENCY;
    expect(harvestYieldItemId(meta, t3)).toBe('fine_thorium_ore');
  });

  it('the corpse premium arm resolves through the wield-aware any-scan (R50, source pin)', () => {
    // Behaviorally unreachable in shipped content (every wave-one component
    // family is tier 1 and bare hands floor the scan there), so the seam is
    // pinned at the source: the corpse harvester must read the wield-aware
    // any-profession scan with the player's counters, not the ownership
    // scan. Whitespace-normalized so a formatter wrap cannot dodge it;
    // comments stripped so prose cannot satisfy it.
    const source = readFileSync(path.resolve(process.cwd(), 'src/sim/interaction.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1')
      .replace(/\s+/g, '')
      .replace(/,\)/g, ')');
    expect(source).toContain(
      'bestWieldableAnyGatherToolTier(meta.inventory,meta.gatheringProficiency,ITEMS)',
    );
    expect(source).not.toContain('bestOwnedAnyGatherToolTier(');
    // And the denial names a wield requirement when one applies.
    expect(source).toContain('minWieldRequirementToWorkAny(');
  });
});

describe('the vendor view core renders the advisory requirement, never drops a row', () => {
  const stock = ['copper_mining_pick', 'iron_mining_pick'];
  const balances = { copper: 1_000_000, honor: 0 } as const;

  it('keeps the requirement-unmet row in the goods list and carries its requirement', () => {
    const view = buildVendorView(stock, [], ITEMS, { ...balances, gatheringProficiency: {} });
    expect(view.goods.map((g) => g.itemId)).toEqual(stock);
    const [entry, gated] = view.goods;
    expect(entry.requirementUnmet).toBe(false);
    expect(entry.requirement).toBeUndefined();
    expect(gated.requirementUnmet).toBe(true);
    expect(gated.requirement).toEqual({
      professionId: 'mining',
      proficiency: TIER2_TOOL_GATE_PROFICIENCY,
    });
    // Affordability is a separate axis and stays true: the requirement is
    // advisory (R22), and the painter must not conflate the two.
    expect(gated.affordable).toBe(true);
  });

  it('clears the flag at the threshold the shared resolver uses', () => {
    const view = buildVendorView(stock, [], ITEMS, {
      ...balances,
      gatheringProficiency: { mining: TIER2_TOOL_GATE_PROFICIENCY },
    });
    expect(view.goods.find((g) => g.itemId === 'iron_mining_pick')?.requirementUnmet).toBe(false);
  });

  it('an EMPTY proficiency map marks every requirement row unmet rather than met', () => {
    // The map is a required field, so it can no longer be forgotten silently;
    // what remains reachable is a caller satisfying the type with an empty
    // object. That must read unmet (the under-promising direction): a wrong
    // advisory line understates what the buyer can already do, never
    // overstates it.
    const view = buildVendorView(stock, [], ITEMS, { ...balances, gatheringProficiency: {} });
    expect(view.goods.find((g) => g.itemId === 'iron_mining_pick')?.requirementUnmet).toBe(true);
    expect(view.goods.find((g) => g.itemId === 'copper_mining_pick')?.requirementUnmet).toBe(false);
  });

  it('agrees with the SHARED RESOLVER on every stocked tool across a proficiency sweep', () => {
    // The view and the wield table cannot disagree because the advisory
    // constants alias the wield constants and both surfaces call one
    // resolver; this sweeps that agreement across the whole stocked ladder.
    const toolStock = Object.keys(ITEMS).filter((id) => {
      const use = ITEMS[id].use;
      return use?.type === 'gatherTool' && ITEMS[id].buyValue !== undefined;
    });
    expect(toolStock.length).toBeGreaterThan(0);
    for (const proficiency of [0, 39, 40, 69, 70, 100]) {
      const map = { mining: proficiency, logging: proficiency, herbalism: proficiency };
      const view = buildVendorView(toolStock, [], ITEMS, {
        ...balances,
        gatheringProficiency: map,
      });
      for (const row of view.goods) {
        expect(row.requirementUnmet, `${row.itemId} at ${proficiency}`).toBe(
          resolveVendorRowGate(row.itemId, map).locked,
        );
      }
    }
  });
});

describe('the HUD actually feeds the viewer proficiency into the view', () => {
  it('passes gatheringProficiency into buildVendorView', () => {
    // The one line the rest of this file cannot reach: every other arm hands
    // the map in by hand, and no test constructs a real Hud. Deleting that
    // argument is now a compile error (VendorBalances requires the field), but
    // a caller could still satisfy the type with an empty literal, which the
    // resolver reads as 0 and which therefore LOCKS every gated row for every
    // player at any proficiency, silently, in the safe-looking direction.
    // Comments are stripped first so a mention in prose cannot satisfy it.
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    const call = source.slice(source.indexOf('buildVendorView('));
    expect(call.startsWith('buildVendorView(')).toBe(true);
    const args = call.slice(0, call.indexOf('),\n'));
    expect(args).toContain('gatheringProficiency:');
    // and it comes from the world, not from a literal.
    expect(args).toMatch(/gatheringProficiency:\s*this\.sim\.gatheringProficiency/);
  });

  it('closes its service windows on the shared constant, never on an inlined number', () => {
    // The geometry arm below reads NPC_WINDOW_CLOSE_RANGE, so it only guards
    // the separation while the HUD still reads it too. Replacing the proximity
    // literals with a bare number leaves the constant at 8, the arm green, and
    // the stale-lock hole re-opened, so pin the read itself.
    //
    // The corpus is hud.ts PLUS every module under src/ui/hud/: the repo is
    // actively extracting HUD domains into that tree, and a consumer already
    // lives there (the quest dialog controller), so a hud.ts-only walk would
    // silently shrink the day a close check moves into a domain module.
    const stripped = (file: string) =>
      readFileSync(path.resolve(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    const corpus: { file: string; source: string }[] = [
      { file: 'src/ui/hud.ts', source: stripped('src/ui/hud.ts') },
    ];
    for (const entry of readdirSync(path.resolve(process.cwd(), 'src/ui/hud'), {
      recursive: true,
    })) {
      const rel = String(entry);
      if (!rel.endsWith('.ts')) continue;
      corpus.push({ file: `src/ui/hud/${rel}`, source: stripped(`src/ui/hud/${rel}`) });
    }
    expect(corpus.length, 'the hud domain tree is in the corpus').toBeGreaterThan(5);

    // Every service-window proximity check compares against the constant.
    const checkRe = /dist2d\((?:p|world\.player)\.pos, npc\.pos\) > ([A-Za-z_0-9.]+)/g;
    let checks = 0;
    let questControllerChecks = 0;
    for (const { file, source } of corpus) {
      for (const [, operand] of source.matchAll(checkRe)) {
        checks++;
        if (file.includes('quest_dialog_controller')) questControllerChecks++;
        expect(operand, `${file}: proximity check compares against the shared constant`).toBe(
          'NPC_WINDOW_CLOSE_RANGE',
        );
      }
    }
    expect(checks, 'the proximity checks are still there').toBeGreaterThanOrEqual(5);
    // Floor on the out-of-hud.ts consumer: if the corpus walk regresses to
    // hud.ts only, this is the assertion that reddens.
    expect(questControllerChecks, 'the quest dialog controller read is seen').toBeGreaterThan(0);

    // Invariant-shaped, not spelling-shaped: the loop above only sees the
    // `.pos, npc.pos` spellings and a count floor cannot notice an extra
    // check, so a window closing on `dist2d(p.pos, merchant.pos) > 30` would
    // sail past it. No dist2d comparison in the corpus may use a numeric
    // literal on either side: the old greater-than-only sweep missed the
    // market-NPC `<= 8` for the file's whole life (a hand-inlined copy of the
    // value NPC_WINDOW_CLOSE_RANGE names, since renamed onto the constant),
    // and its argument class could not span a nested call like
    // `dist2d(worldPos(a), b.pos)`, so one paren level is allowed now.
    const literalRight = /dist2d\((?:[^()]|\([^()]*\))*\)\s*[<>]=?\s*[0-9]/g;
    const literalLeft = /[^A-Za-z_0-9.][0-9][0-9.]*\s*[<>]=?\s*dist2d\(/g;
    // Self-audit first: a mistyped character class would match nothing and
    // pass forever, which is the exact failure mode this arm was rewritten
    // to fix. Prove the regexes still bite on synthetic violations.
    expect('if (dist2d(p.pos, npc.pos) > 8) close();'.match(literalRight)).not.toBeNull();
    expect('if (dist2d(a, b) <= 8) close();'.match(literalRight)).not.toBeNull();
    expect('if (dist2d(worldPos(a), b.pos) < 30) close();'.match(literalRight)).not.toBeNull();
    expect('if (8 >= dist2d(p.pos, npc.pos)) close();'.match(literalLeft)).not.toBeNull();
    for (const { file, source } of corpus) {
      expect(
        [...source.matchAll(literalRight)].map((m) => `${file}: ${m[0]}`),
        'a dist2d range compared against a bare number',
      ).toEqual([]);
      expect(
        [...source.matchAll(literalLeft)].map((m) => `${file}: ${m[0]}`),
        'a bare number compared against a dist2d range (Yoda order)',
      ).toEqual([]);
    }
  });
});

describe('the gated tools are stocked somewhere a gated row can be seen', () => {
  it('every gated tool sits in at least one NPC counter', () => {
    // A gate on a row no merchant carries would be unreachable content: the
    // requirement line could never render, and the ladder would have a rung
    // that exists only in the item table.
    for (const itemId of Object.keys(VENDOR_ROW_GATES)) {
      const stockists = Object.values(NPCS).filter((npc) => npc.vendorItems?.includes(itemId));
      expect(stockists.length, `${itemId} is stocked by no NPC`).toBeGreaterThan(0);
    }
  });

  it('no hub anywhere stocks a land tool above its own zone node tier', () => {
    // The rule that justifies the Eastbrook tool de-stock (the higher-tier
    // ids came off every counter that carried them), DERIVED rather than
    // enumerated. The hand-written arms in tests/professions_tools.test.ts
    // are a lower bound per zone ("Fenbridge stocks at least these"), so they
    // could not have caught the bug this change fixes: Eastbrook broke this
    // rule for its whole life and shipped green, and dropping a tier-3 axe onto
    // the Fenbridge counter would still ship green today. This arm is the upper
    // bound, and it holds for every current and future tool-stocking NPC.
    const maxNodeTierInZone = new Map<string, number>();
    for (const node of GATHER_NODES) {
      maxNodeTierInZone.set(
        node.zoneId,
        Math.max(maxNodeTierInZone.get(node.zoneId) ?? 0, node.tier),
      );
    }
    expect(maxNodeTierInZone.size).toBeGreaterThan(0);

    // NPC z coordinates map to zones the way the world does; resolve each
    // stocking NPC to its zone through the shipped zone lookup rather than by
    // hand, so a relocated merchant is judged against its new ground.
    let gatedRowsChecked = 0;
    const ceilingsExercised = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        const use = ITEMS[itemId]?.use;
        // Land tools only: rods pace against WATER tiers, not node tiers
        // (professions/fishing_zones.ts), and Wilkes deliberately keeps the
        // whole rod ladder as the buy-ahead counter (R20), so the
        // node-ceiling rule this arm derives is a land-tool rule; the rod
        // hub rows have their own pins in professions_tools.test.ts.
        if (use?.type !== 'gatherTool' || use.professionId === 'fishing') continue;
        const zone = zoneAt(npc.pos.x, npc.pos.z);
        // zoneAt SATURATES: it walks bands by zMax and falls back to the last
        // zone, so an NPC past the final band (or at a NaN z) silently resolves
        // to the highest-ceilinged zone in the world and would be judged against
        // the most permissive ground there is. Assert the resolved zone really
        // contains the merchant, so a fallback fails instead of passing free.
        expect(
          npc.pos.z >= zone.zMin && npc.pos.z < zone.zMax,
          `${npc.id} at z=${npc.pos.z} resolved to ${zone.id} (${zone.zMin}..${zone.zMax}) by fallback`,
        ).toBe(true);
        const nodeCeiling = maxNodeTierInZone.get(zone.id) ?? 0;
        expect(
          use.tier,
          `${npc.id} (${zone.id}) stocks ${itemId} at tier ${use.tier} above its ground's ${nodeCeiling}`,
        ).toBeLessThanOrEqual(nodeCeiling);
        if (use.tier >= 2) gatedRowsChecked++;
        ceilingsExercised.add(zone.id);
      }
    }
    // Non-vacuity, counting only the rows this rule can actually constrain: a
    // tier-1 row satisfies `tier <= ceiling` in every zone trivially, so a
    // count over ALL tool rows is met by the tier-1 rows alone and the sweep
    // could pass having seen no gated row at all.
    expect(gatedRowsChecked, 'the sweep must see the tier-2 and tier-3 rows').toBe(9);
    // And it must have judged every zone that stocks tools, not just one.
    expect(ceilingsExercised.size).toBe(3);
  });

  it('no gated counter sits close enough to a node to harvest with its window open', () => {
    // Why this is worth asserting: the vendor row's lock is ADVISORY and is
    // painted when the window opens. Nothing repaints it on a proficiency
    // change, which is only correct because a player cannot cross a threshold
    // while looking at a gated row. The window closes past VENDOR_CLOSE_RANGE
    // of the merchant (hud.ts, the openVendorNpcId proximity check) and a
    // harvest needs the player within INTERACT_RANGE of the node, so the two
    // standing circles have to be disjoint for that to hold.
    //
    // If content ever moves a node or a tool-stocking merchant inside this
    // gap, the stale-lock case becomes real and the vendor window needs a
    // repaint hook. Failing here is the signal to make that call deliberately.
    // Imported, never re-stated: a hand-copied 8 made this arm one-sided, so
    // widening the HUD's close range left it green while the stale-lock case
    // it guards became real.
    const reach = NPC_WINDOW_CLOSE_RANGE + INTERACT_RANGE;
    const gatedStockists = Object.values(NPCS).filter((npc) =>
      (npc.vendorItems ?? []).some((itemId) => VENDOR_ROW_GATES[itemId]),
    );
    // Non-vacuity on BOTH dimensions: an empty stockist list or an empty node
    // table would leave `closest` at Infinity and pass without comparing a
    // single pair.
    expect(gatedStockists.length).toBeGreaterThan(0);
    expect(GATHER_NODES.length).toBeGreaterThan(0);
    let closest = Number.POSITIVE_INFINITY;
    let closestPair = '';
    for (const npc of gatedStockists) {
      for (const node of GATHER_NODES) {
        const d = Math.hypot(node.pos.x - npc.pos.x, node.pos.z - npc.pos.z);
        if (d < closest) {
          closest = d;
          closestPair = `${npc.id} to ${node.id}`;
        }
      }
    }
    expect(closest, `${closestPair} is inside the vendor-open harvest reach`).toBeGreaterThan(
      reach,
    );
  });
});
