// The recharge_tool_effect command end to end (the acquisition craft's
// second half): R39 pricing and R30 refills driven through the real Sim
// command, plus the economics inequality that keeps re-slotting from ever
// bypassing recharges (the craft's mint reagents must out-cost the most
// expensive generic recharge any shipped tool can price).

import { describe, expect, it } from 'vitest';
import type { TOOL_EFFECT_IDS } from '../src/sim/content/professions';
import { TOOL_EFFECT_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { requiredReagentCountFor } from '../src/sim/professions/crafting';
import { DISENCHANT_MATERIAL_BY_QUALITY } from '../src/sim/professions/disenchant_reagents';
import {
  NO_TOOL_OWNED,
  normalizeToolEffectSlots,
  RECHARGE_CHARGES_PER_MATERIAL,
  rarityLadderIndex,
  startingDurabilityFor,
} from '../src/sim/professions/tools';
import {
  bestWieldableGatherToolTierOrNone,
  TIER4_TOOL_WIELD_PROFICIENCY,
} from '../src/sim/professions/wield_gate';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const makeSim = (seed = 11) => new Sim({ seed, playerClass: 'warrior', autoEquip: false });
const metaOf = (sim: Sim): PlayerMeta => sim.meta(sim.playerId) as PlayerMeta;

/** Slot a self-crafted charm onto mining with the given pick carried. */
function simWithSlot(pickId = 'copper_mining_pick'): Sim {
  const sim = makeSim();
  sim.addItem(pickId, 1);
  sim.addItemInstance('gatherers_cache', { signer: metaOf(sim).name }, sim.playerId, 1);
  sim.slotToolEffect('mining', 'gatherers_cache');
  return sim;
}

function lastToolEffectResult(events: SimEvent[]): SimEvent | undefined {
  return events.filter((ev) => ev.type === 'toolEffectResult').at(-1);
}

describe('the recharge command: price, consume, refill', () => {
  it('a depleted slot refills to the re-derived max, consuming the priced materials exactly', () => {
    const sim = simWithSlot();
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.addItem('arcane_dust', 10);
    sim.rechargeToolEffect('mining');
    const events = sim.tick();
    // Common pick: 20-charge fill, self-crafted slot: ceil((20/10) * 0.5) = 1.
    expect(slot.durability).toBe(20);
    expect(slot.maxDurability).toBe(20);
    expect(sim.countItem('arcane_dust')).toBe(9);
    // craftedBy survives the recharge: provenance is permanent.
    expect(slot.craftedBy).toBe(metaOf(sim).name);
    expect(lastToolEffectResult(events)).toMatchObject({
      action: 'recharge',
      ok: true,
      materialItemId: 'arcane_dust',
      count: 1,
    });
  });

  it('a foreign-crafted slot pays the full generic count', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    expect(slot.craftedBy).toBe('Elsewhere');
    slot.durability = 0;
    sim.addItem('arcane_dust', 10);
    sim.rechargeToolEffect('mining');
    sim.tick();
    // Generic rate: ceil(20/10) = 2 dust, no discount for a buyer.
    expect(slot.durability).toBe(20);
    expect(sim.countItem('arcane_dust')).toBe(8);
  });

  it('every deny arm consumes nothing and names itself on the event', () => {
    // no_slot: nothing slotted at all.
    const bare = makeSim();
    bare.addItem('arcane_dust', 10);
    bare.rechargeToolEffect('mining');
    expect(lastToolEffectResult(bare.tick())).toMatchObject({ ok: false, reason: 'no_slot' });
    expect(bare.countItem('arcane_dust')).toBe(10);

    // no_tool: the pick left the bags after slotting, so the R30 rarity
    // cannot resolve (mirrors the slot gate).
    const toolless = simWithSlot();
    toolless.removeItem('copper_mining_pick', 1);
    const tSlot = metaOf(toolless).toolEffectSlots?.mining;
    if (!tSlot) throw new Error('slot minted');
    tSlot.durability = 0;
    toolless.addItem('arcane_dust', 10);
    toolless.rechargeToolEffect('mining');
    expect(lastToolEffectResult(toolless.tick())).toMatchObject({
      ok: false,
      reason: 'no_tool',
      effectId: 'gatherers_cache',
    });
    expect(toolless.countItem('arcane_dust')).toBe(10);

    // already_full: a fresh slot has nothing to restore. Every deny that has
    // a resolved slot carries `effectId` (pinned on each arm): the client
    // renders the effect's NAME into the line, and a dropped id paints an
    // empty-name sentence.
    const full = simWithSlot();
    full.addItem('arcane_dust', 10);
    full.rechargeToolEffect('mining');
    expect(lastToolEffectResult(full.tick())).toMatchObject({
      ok: false,
      reason: 'already_full',
      effectId: 'gatherers_cache',
    });
    expect(full.countItem('arcane_dust')).toBe(10);

    // insufficient_materials: the event carries the price so the player
    // learns the cost from the refusal itself.
    const broke = simWithSlot();
    const bSlot = metaOf(broke).toolEffectSlots?.mining;
    if (!bSlot) throw new Error('slot minted');
    bSlot.durability = 0;
    broke.rechargeToolEffect('mining');
    expect(lastToolEffectResult(broke.tick())).toMatchObject({
      ok: false,
      reason: 'insufficient_materials',
      materialItemId: 'arcane_dust',
      count: 1,
      effectId: 'gatherers_cache',
    });

    // throttled: the shared crafting-action window refuses after the
    // materials check (the family order: inputs first, window last) and
    // spends nothing.
    const paced = simWithSlot();
    const pSlot = metaOf(paced).toolEffectSlots?.mining;
    if (!pSlot) throw new Error('slot minted');
    pSlot.durability = 0;
    paced.addItem('arcane_dust', 10);
    metaOf(paced).craftThrottle = { windowStart: 0, count: 1000 };
    paced.rechargeToolEffect('mining');
    expect(lastToolEffectResult(paced.tick())).toMatchObject({
      ok: false,
      reason: 'throttled',
      effectId: 'gatherers_cache',
    });
    expect(paced.countItem('arcane_dust')).toBe(10);
    expect(pSlot.durability).toBe(0);
  });

  it('a throttled AND broke player gets the price-carrying deny, the family order', () => {
    // crafting.ts, enchanting.ts, and salvage.ts all validate the action's
    // own inputs before the shared window; insufficient_materials is the one
    // deny that carries the cost, so it must win the race with throttled.
    const sim = simWithSlot();
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    metaOf(sim).craftThrottle = { windowStart: 0, count: 1000 };
    sim.rechargeToolEffect('mining');
    expect(lastToolEffectResult(sim.tick())).toMatchObject({
      ok: false,
      reason: 'insufficient_materials',
      materialItemId: 'arcane_dust',
      count: 1,
    });
  });

  it('the recharge paces the shared craft window on success only', () => {
    // recordAction on the success arm, and NOTHING on a deny: a refused
    // recharge must not delay the player's next real craft.
    const sim = simWithSlot();
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.addItem('arcane_dust', 10);
    const before = metaOf(sim).craftThrottle?.count ?? 0;
    sim.rechargeToolEffect('mining');
    expect(metaOf(sim).craftThrottle?.count ?? 0).toBe(before + 1);
    // A deny (already full now) leaves the window untouched.
    const after = metaOf(sim).craftThrottle?.count ?? 0;
    sim.rechargeToolEffect('mining');
    expect(metaOf(sim).craftThrottle?.count ?? 0).toBe(after);
  });

  it('a recharge whose fill EXCEEDS the stored ceiling raises it: the high-water write is live', () => {
    // Ordinary-play reachable: mint on a common pick (ceiling 20), later buy
    // an epic pick, recharge. The fill sizes at 50 (R30) and the ceiling
    // must follow it up, or normalizeToolEffectSlots clamps durability back
    // to 20 on the next load and the player silently loses 30 paid charges.
    const sim = simWithSlot();
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'common'));
    slot.durability = 5;
    sim.addItem('arcanite_mining_pick', 1);
    sim.addItem('arcane_shard', 10);
    sim.rechargeToolEffect('mining');
    const events = sim.tick();
    expect(slot.durability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    // Priced at the epic rung for the 45 restored charges, self-crafted:
    // ceil((45/10) x 0.5) = 3 shards.
    expect(sim.countItem('arcane_shard')).toBe(7);
    expect(lastToolEffectResult(events)).toMatchObject({
      ok: true,
      materialItemId: 'arcane_shard',
      count: 3,
    });
    // And the raised ceiling survives the load normalizer: the exact loss
    // the raise arm exists to prevent.
    const normalized = normalizeToolEffectSlots(
      JSON.parse(JSON.stringify(metaOf(sim).toolEffectSlots)),
    );
    expect(normalized?.mining?.durability).toBe(50);
    expect(normalized?.mining?.maxDurability).toBe(50);
  });

  it('R30 at the command: a lesser tool fills only to its own rung, and pays the ceiling rung', () => {
    // Minted on an epic pick (50 charges), pick then traded away for a common
    // one. R30: the fill is sized by the tool held NOW (20). R47: the PRICE
    // rung is floored at the slot's own ceiling, which the lesser tool never
    // lowers, so the cheap-tool fill is billed in SHARDS, not dust, and
    // stashing a good pick can never buy a cheap refill.
    const sim = makeSim();
    sim.addItem('arcanite_mining_pick', 1);
    sim.addItemInstance('artisans_eye', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'artisans_eye');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    expect(slot.maxDurability).toBe(50);
    sim.removeItem('arcanite_mining_pick', 1);
    sim.addItem('copper_mining_pick', 1);
    sim.addItem('arcane_dust', 10);
    sim.addItem('arcane_shard', 10);
    // Above what this tool can fill, below the ceiling: the honest distinction.
    slot.durability = 30;
    sim.rechargeToolEffect('mining');
    expect(lastToolEffectResult(sim.tick())).toMatchObject({ ok: false, reason: 'tool_capped' });
    expect(slot.durability).toBe(30);
    expect(slot.maxDurability).toBe(50);
    // Below it: the fill lands at 20, and it costs 2 SHARDS (the ceiling
    // rung), never the 2 dust the carried pick alone would have priced.
    slot.durability = 5;
    sim.rechargeToolEffect('mining');
    expect(lastToolEffectResult(sim.tick())).toMatchObject({
      ok: true,
      materialItemId: 'arcane_shard',
      count: 2,
    });
    expect(slot.durability).toBe(20);
    expect(slot.maxDurability).toBe(50);
    expect(sim.countItem('arcane_dust')).toBe(10);
    expect(sim.countItem('arcane_shard')).toBe(8);
    // At the tool's own fill target with the ceiling above: tool_capped, not
    // "already fully charged", so the line can point at the tool.
    sim.rechargeToolEffect('mining');
    expect(lastToolEffectResult(sim.tick())).toMatchObject({ ok: false, reason: 'tool_capped' });
    // Carrying the epic pick again fills to the ceiling at the same rung.
    sim.addItem('arcanite_mining_pick', 1);
    sim.rechargeToolEffect('mining');
    expect(lastToolEffectResult(sim.tick())).toMatchObject({
      ok: true,
      materialItemId: 'arcane_shard',
      count: 3,
    });
    expect(slot.durability).toBe(50);
    expect(slot.maxDurability).toBe(50);
  });

  it('R47: the split-fill and stash-the-pick arbitrages both price at the ceiling rung', () => {
    // The exploit the adversarial pass found: derive the price rung from bag
    // state alone and an epic-cap refill completes at roughly a third its
    // price (ascending partial fills), or every fill prices in dust forever
    // (stash the pick). Both are now strictly worse than filling honestly.
    const sim = makeSim();
    sim.addItem('arcanite_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.addItem('arcane_dust', 50);
    sim.addItem('arcane_essence', 50);
    sim.addItem('arcane_shard', 50);
    // Step one of the ascending ladder: the epic pick stashed, a common pick
    // carried. The fill is common-sized (20) but billed in shards.
    sim.removeItem('arcanite_mining_pick', 1);
    sim.addItem('copper_mining_pick', 1);
    sim.rechargeToolEffect('mining');
    sim.tick();
    expect(sim.countItem('arcane_dust')).toBe(50);
    expect(sim.countItem('arcane_essence')).toBe(50);
    expect(sim.countItem('arcane_shard')).toBe(48);
    // The cheap fill must not have collapsed the high-water ceiling: this is
    // the write the whole exploit needs, so it gets its own pin here in the
    // arm named for it.
    expect(slot.maxDurability).toBe(50);
    // Running the ladder to the top costs the SAME five shards the honest
    // single fill costs (2 + 3, every step billed at the ceiling rung), never
    // the 3 dust + 1 essence + 1 shard the bag-state pricing allowed. Ceil
    // rounding can only make a finer split cost more, never less, so there is
    // no ladder that beats filling honestly.
    sim.addItem('arcanite_mining_pick', 1);
    sim.rechargeToolEffect('mining');
    sim.tick();
    expect(slot.durability).toBe(50);
    expect(sim.countItem('arcane_shard')).toBe(45);
    expect(sim.countItem('arcane_dust')).toBe(50);
    expect(sim.countItem('arcane_essence')).toBe(50);
  });

  it('R47/R30 read the best tool OWNED: an unwieldable pick still sets the price rung', () => {
    // The ruling boundary, stated: the wield gate (professions/wield_gate.ts)
    // filters ACCESS, so a tier-4 pick under its 85 requirement works no node
    // at all, while the R47/R30 price family reads the best tool OWNED. They
    // price, they do not gate. A wieldability read here would answer no_tool
    // and price nothing, which is why the rung below is the assertion.
    const run = (miningProficiency: number) => {
      const sim = makeSim();
      sim.addItem('copper_mining_pick', 1);
      sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
      sim.slotToolEffect('mining', 'gatherers_cache');
      const slot = metaOf(sim).toolEffectSlots?.mining;
      if (!slot) throw new Error('slot minted');
      // Minted on the common pick (ceiling 20), which then leaves the bags:
      // the tier-4 RARE pick is the only mining tool carried from here on.
      expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'common'));
      sim.removeItem('copper_mining_pick', 1);
      sim.addItem('thorium_mining_pick', 1);
      metaOf(sim).gatheringProficiency.mining = miningProficiency;
      slot.durability = 0;
      sim.addItem('arcane_essence', 10);
      sim.rechargeToolEffect('mining');
      return { sim, slot, events: sim.tick() };
    };
    const { sim, slot, events } = run(0);
    // POSITIVE CONTROL: the wield filter really refuses this pick at mining 0
    // and really admits it at its requirement, so the recharge below is
    // resolving off a tool the player genuinely cannot swing.
    expect(
      bestWieldableGatherToolTierOrNone(metaOf(sim).inventory, 'mining', 0, ITEMS),
      'the fixture pick must be unwieldable at mining 0',
    ).toBe(NO_TOOL_OWNED);
    expect(
      bestWieldableGatherToolTierOrNone(
        metaOf(sim).inventory,
        'mining',
        TIER4_TOOL_WIELD_PROFICIENCY,
        ITEMS,
      ),
    ).toBe(4);
    // Priced and filled at the RARE rung the unwieldable pick carries: 40
    // charges billed in arcane_essence, never the arcane_dust the slot's own
    // common ceiling would have named on its own.
    expect(lastToolEffectResult(events)).toMatchObject({
      action: 'recharge',
      ok: true,
      materialItemId: 'arcane_essence',
      count: 4,
    });
    expect(slot.durability).toBe(startingDurabilityFor('gatherers_cache', 'rare'));
    expect(slot.durability).toBe(40);
    expect(slot.maxDurability).toBe(40);
    expect(sim.countItem('arcane_essence')).toBe(6);
    // With the counter earned the answer is the same one, against the same
    // literals rather than against the arm above: the ruling is that none of
    // these numbers ever depended on the counter.
    const earned = run(TIER4_TOOL_WIELD_PROFICIENCY);
    expect(lastToolEffectResult(earned.events)).toMatchObject({
      action: 'recharge',
      ok: true,
      materialItemId: 'arcane_essence',
      count: 4,
    });
    expect(earned.slot.durability).toBe(40);
    expect(earned.slot.maxDurability).toBe(40);
    expect(earned.sim.countItem('arcane_essence')).toBe(6);
  });

  it('slotting and recharging draw no rng at all', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: metaOf(sim).name }, sim.playerId, 1);
    sim.addItem('arcane_dust', 10);
    // The PUBLIC observer seam, never the private field: writing `.observer`
    // directly would keep passing (vacuously) if the Rng reshaped its
    // internals, and an uninstalled observer is indistinguishable from "no
    // draws happened".
    const drawn: number[] = [];
    sim.rng.setObserver((v) => drawn.push(v));
    // POSITIVE CONTROL FIRST: prove the observer really watches this Rng.
    sim.rng.next();
    expect(drawn, 'the observer must see a real draw').toHaveLength(1);
    drawn.length = 0;
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.rechargeToolEffect('mining');
    sim.rng.setObserver(null);
    expect(drawn).toEqual([]);
    expect(slot.durability).toBe(20);
  });
});

describe('the R39 economics inequality: a fresh mint always out-costs a generic recharge', () => {
  // The same price basis recipe_economy.test.ts uses: buyValue when a vendor
  // sells the reagent for copper, else sellValue.
  const unitValue = (itemId: string): number => {
    const def = ITEMS[itemId];
    if (!def) throw new Error(`no ItemDef for ${itemId}`);
    return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
  };

  // Every rarity rung a SHIPPED gathering tool can resolve at recharge time:
  // derived from the live item table, so the day a legendary tool ships, its
  // rung joins this set and the inequality below must survive the retune.
  const reachableRungs = [
    ...new Set(
      Object.values(ITEMS)
        .filter((def) => def.use?.type === 'gatherTool')
        .map((def) => def.quality ?? 'common'),
    ),
  ];

  /** The mint's real reagent value for a crafter, priced through the sim's
   *  OWN consumption resolver rather than the listed counts: a specialized
   *  enchanter consumes floor(count x 0.8) of each reagent, and that is the
   *  arm that competes with a recharge. The listed-count arm is `{}` skills. */
  const mintValue = (
    recipe: (typeof TOOL_EFFECT_RECIPES)[number],
    skills: Record<string, number>,
  ): number =>
    recipe.reagents.reduce((total, reagent) => {
      const { count } = requiredReagentCountFor(false, reagent, skills, recipe.professionId);
      return total + count * unitValue(reagent.itemId);
    }, 0);

  it('holds for every craftable effect at every reachable rung, discounted or not', () => {
    expect(reachableRungs.length).toBeGreaterThanOrEqual(3); // non-vacuity
    // Specialized in the recipe's own craft: the cheapest mint a player can
    // actually perform. Pricing only the listed counts is what let a
    // specialized crafter's 225-copper re-mint undercut the 275-copper
    // generic epic recharge while this test stayed green.
    const specialized = { enchanting: 125 };
    for (const recipe of TOOL_EFFECT_RECIPES) {
      const listed = mintValue(recipe, {});
      const cheapest = mintValue(recipe, specialized);
      expect(cheapest, `${recipe.id}: the discount must really bite`).toBeLessThan(listed);
      for (const rung of reachableRungs) {
        const fill = startingDurabilityFor(
          recipe.resultItemId as (typeof TOOL_EFFECT_IDS)[number],
          rung,
        );
        const genericCount = Math.ceil(fill / RECHARGE_CHARGES_PER_MATERIAL);
        const ladderRung = ['common', 'uncommon', 'rare', 'epic', 'legendary'][
          rarityLadderIndex(rung)
        ];
        const rechargeValue = genericCount * unitValue(DISENCHANT_MATERIAL_BY_QUALITY[ladderRung]);
        expect(
          cheapest,
          `${recipe.id} at the ${String(rung)} rung: the CHEAPEST mint ${cheapest} must ` +
            `exceed the generic full-fill recharge ${rechargeValue}, or re-crafting a fresh ` +
            `charm becomes the cheap recharge`,
        ).toBeGreaterThan(rechargeValue);
      }
    }
  });

  it('pins the shipped constants so a one-sided retune cannot drift silently', () => {
    for (const recipe of TOOL_EFFECT_RECIPES) {
      // 5 shards (55) + 4 essence (18) + 6 dust (6) = 383 copper listed,
      // 4 + 3 + 4 = 298 for a specialized enchanter.
      expect(mintValue(recipe, {})).toBe(383);
      expect(mintValue(recipe, { enchanting: 125 })).toBe(298);
    }
    // The worst generic recharge a shipped tool can price: an epic tool's
    // 50-charge fill at 5 shards.
    const worstFill = startingDurabilityFor('gatherers_cache', 'epic');
    expect(worstFill).toBe(50);
    expect(Math.ceil(worstFill / RECHARGE_CHARGES_PER_MATERIAL) * unitValue('arcane_shard')).toBe(
      275,
    );
    // The self-signed reduction (crafting.ts, one unit off before the
    // multiplier) would drop the specialized mint to 225 and break the bound,
    // and it is unreachable ONLY because no path mints a signed arcane
    // material: the disenchant primary grants plain, and node yields are
    // never arcane. Pinned so a future signed-material source has to face
    // this bound rather than quietly slipping under it.
    const selfSigned = TOOL_EFFECT_RECIPES[0].reagents.reduce((total, reagent) => {
      const { count } = requiredReagentCountFor(true, reagent, { enchanting: 125 }, 'enchanting');
      return total + count * unitValue(reagent.itemId);
    }, 0);
    expect(selfSigned).toBeLessThan(275);
    for (const reagent of TOOL_EFFECT_RECIPES[0].reagents) {
      expect(
        Object.values(ITEMS).some(
          (def) => def.id === reagent.itemId && typeof def.buyValue === 'number',
        ),
        `${reagent.itemId} must stay off the copper counters`,
      ).toBe(false);
    }
  });
});
