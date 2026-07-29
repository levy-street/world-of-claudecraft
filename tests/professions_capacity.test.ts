// #2350: the profession transforms (craft, salvage, disenchant, apply-enchant,
// and the unbind stack split) must respect bag capacity. Each command models
// the post-consumption inventory on a scratch copy (consuming the inputs can
// legitimately free the room the output needs) and denies with a stable
// no-space reason code, no side effects, and NO rng draw when the output
// cannot fit. The worst-case rule: a denial can never depend on a roll the
// deny arm does not make, so rng-sized yields pre-fit their maximum (the +1
// bonus arm, two epic secondaries) and a masterwork-possible craft pre-fits
// BOTH grant shapes.
import { afterAll, describe, expect, it } from 'vitest';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import { STATIONS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { unbindItem } from '../src/sim/professions/commission';
import { resolveCraft, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import {
  disenchantYield,
  maxDisenchantYield,
  resolveApplyEnchant,
  resolveDisenchant,
} from '../src/sim/professions/enchanting';
import { masterworkBonusStats } from '../src/sim/professions/masterwork';
import { maxSalvageYield, resolveSalvage, salvageYield } from '../src/sim/professions/salvage';
import type { StationType } from '../src/sim/professions/stations';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';

const FILLER = 'simple_fishing_pole'; // tool: one per slot, merges with nothing
const SWORD = 'eastbrook_arming_sword'; // common mainhand weapon
const JERKY_RECIPE = 'recipe_tough_jerky'; // 1 spider_leg -> 1 tough_jerky, no station
const ENCHANT = 'enchant_weapon_might'; // mainhand, 5 arcane_dust

// Synthetic defs, the professions_enchant_salvage_edges.test.ts QA-item
// pattern: registered here, removed in afterAll so no other suite sees them.
const QA_RARE = '__cap_qa_rare_sword';
const QA_EPIC = '__cap_qa_epic_sword';
// A stackable def that can masterwork (slot + primary stats): only such an
// output diverges between the plain grant shape (fungible, merges into an
// existing stack) and the masterwork shape (a signed instance needing its own
// slot), which is exactly what the both-shapes pin below needs.
const QA_MW = '__cap_qa_mw_trinket';
const QA_STACK_WEAPON = '__cap_qa_stack_blade';
const qaItems: Record<string, ItemDef> = {
  [QA_RARE]: {
    id: QA_RARE,
    name: 'QA Rare Sword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 5, max: 9, speed: 2.2 },
    sellValue: 1,
  } as ItemDef,
  [QA_EPIC]: {
    id: QA_EPIC,
    name: 'QA Epic Sword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 5, max: 9, speed: 2.2 },
    sellValue: 1,
  } as ItemDef,
  [QA_MW]: {
    id: QA_MW,
    name: 'QA Masterworkable Trinket',
    kind: 'junk',
    slot: 'mainhand',
    quality: 'common',
    stats: { str: 2 },
    sellValue: 1,
  } as ItemDef,
  // A STACKABLE commission-eligible def (explicit stackSize beats the
  // unstacked-kind default): real equipment never stacks, so this is the only
  // way to reach the unbind gate's freed-copy-merges-into-an-unbound-stack
  // arm and pin that the gate models the merge with the exact freed payload.
  [QA_STACK_WEAPON]: {
    id: QA_STACK_WEAPON,
    name: 'QA Stackable Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    stackSize: 5,
    weapon: { min: 5, max: 9, speed: 2.2 },
    sellValue: 1,
  } as ItemDef,
};
for (const [id, def] of Object.entries(qaItems)) {
  (ITEMS as Record<string, ItemDef>)[id] = def;
}
afterAll(() => {
  for (const id of Object.keys(qaItems)) delete (ITEMS as Record<string, ItemDef>)[id];
});

// Level 20: at level 1 the common-to-uncommon primary-stat budget delta
// rounds to zero and masterworkBonusStats returns null (no masterwork
// possible); the both-shapes pin below needs a genuinely masterworkable
// output and asserts that precondition itself.
const qaMwRecipe: ProfessionRecipeRecord = {
  id: '__cap_qa_mw_recipe',
  professionId: 'cooking',
  resultItemId: QA_MW,
  resultCount: 1,
  reagents: [{ itemId: 'spider_leg', count: 1 }],
  skillReq: 0,
  itemLevelBudget: 1,
  level: 20,
} as ProfessionRecipeRecord;

function makeSim(seed = 11) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number) {
  return sim.ctx.resolve(pid)!.meta;
}

/** Replace the inventory with `fillerSlots` unmergeable singles plus `extras`. */
function setBags(sim: Sim, pid: number, fillerSlots: number, extras: ItemDef['id'][] = []) {
  const m = metaOf(sim, pid);
  m.inventory = Array.from({ length: fillerSlots }, () => ({ itemId: FILLER, count: 1 }));
  for (const id of extras) m.inventory.push({ itemId: id, count: 1 });
  return m;
}

function countDraws<T>(sim: Sim, fn: () => T): { result: T; draws: number } {
  let draws = 0;
  sim.ctx.rng.setObserver(() => {
    draws += 1;
  });
  try {
    return { result: fn(), draws };
  } finally {
    sim.ctx.rng.setObserver(null);
  }
}

function standAtStation(sim: Sim, pid: number): void {
  const e = sim.ctx.entities.get(pid)!;
  e.pos.x = STATIONS[0].pos.x;
  e.pos.z = STATIONS[0].pos.z;
}

function standAtStationType(sim: Sim, pid: number, stationType: StationType): void {
  const station = stationsOfType(STATIONS, stationType)[0];
  const e = sim.ctx.entities.get(pid)!;
  e.pos.x = station.pos.x;
  e.pos.z = station.pos.z;
}

describe('craft capacity gate (#2350)', () => {
  it('denies at full bags with no side effects, no rng draw, and no gold fee (the 79/72 repro)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    // The reagent held as a partial stack: consuming one frees no slot, and
    // the output has no existing stack to merge into.
    m.inventory.push({ itemId: 'spider_leg', count: 2 });
    m.copper = 1000;
    expect(bagCapacity(m.bags)).toBe(16);
    const skillsBefore = JSON.stringify(m.craftSkills);
    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY_RECIPE));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    expect(m.inventory.length).toBe(16);
    expect(sim.countItem('spider_leg', pid)).toBe(2);
    expect(sim.countItem('tough_jerky', pid)).toBe(0);
    expect(m.copper).toBe(1000);
    expect(JSON.stringify(m.craftSkills)).toBe(skillsBefore);
    // Repetition can no longer walk the bags past capacity (live report: 79/72).
    const second = resolveCraft(sim.ctx, pid, JERKY_RECIPE);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('no_bag_space');
    expect(m.inventory.length).toBe(16);
  });

  it('succeeds at full bags when consuming the reagents frees the room', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    m.inventory.push({ itemId: 'spider_leg', count: 1 });
    expect(m.inventory.length).toBe(16);
    const result = resolveCraft(sim.ctx, pid, JERKY_RECIPE);
    expect(result.ok).toBe(true);
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
    expect(m.inventory.length).toBe(16);
  });

  it('succeeds at full bags when the output merges into an existing stack', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    m.inventory.push({ itemId: 'spider_leg', count: 2 });
    m.inventory.push({ itemId: 'tough_jerky', count: 1 });
    const result = resolveCraft(sim.ctx, pid, JERKY_RECIPE);
    expect(result.ok).toBe(true);
    expect(sim.countItem('tough_jerky', pid)).toBe(2);
    expect(m.inventory.length).toBe(16);
  });

  it('pre-fits BOTH grant shapes: a masterwork-possible output denies even when the plain copy would merge', () => {
    // A default player's archetype ceiling is the rare tier, so a common-def
    // output with slot + primary stats CAN masterwork, and a proc mints a
    // signed instance that needs its own slot. The gate must not gamble on
    // the proc missing: room for the plain copy alone still denies.
    // Decisiveness guard: the def must actually bake a masterwork bonus, or
    // this test silently degenerates into the plain-shape case.
    expect(
      masterworkBonusStats({
        level: qaMwRecipe.level,
        quality: 'common',
        slot: 'mainhand',
        stats: { str: 2 },
      }),
    ).not.toBeNull();
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    m.inventory.push({ itemId: QA_MW, count: 5 }); // plain-arm merge room
    m.inventory.push({ itemId: 'spider_leg', count: 2 }); // frees nothing
    const { result, draws } = countDraws(sim, () =>
      resolveCraftForRecipe(sim.ctx, pid, qaMwRecipe),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    expect(m.inventory.length).toBe(16);
    // With a free slot for the would-be instance the same craft goes through.
    const sim2 = makeSim(12);
    const pid2 = sim2.playerId;
    const m2 = setBags(sim2, pid2, 13);
    m2.inventory.push({ itemId: QA_MW, count: 5 });
    m2.inventory.push({ itemId: 'spider_leg', count: 2 });
    const ok = resolveCraftForRecipe(sim2.ctx, pid2, qaMwRecipe);
    expect(ok.ok).toBe(true);
    expect(m2.inventory.length).toBeLessThanOrEqual(bagCapacity(m2.bags));
  });

  it('models the commissioned signed instance: denied at full bags, minted armed with a free slot', () => {
    const commRecipe: ProfessionRecipeRecord = {
      ...qaMwRecipe,
      id: '__cap_qa_comm_recipe',
      resultItemId: QA_RARE, // rare equipment: signable AND commission-eligible
      level: 1,
    } as ProfessionRecipeRecord;
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    m.inventory.push({ itemId: 'spider_leg', count: 2 }); // frees nothing
    const denied = resolveCraftForRecipe(sim.ctx, pid, commRecipe, true);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('no_bag_space');
    const sim2 = makeSim(16);
    const pid2 = sim2.playerId;
    const m2 = setBags(sim2, pid2, 14);
    m2.inventory.push({ itemId: 'spider_leg', count: 2 });
    const ok = resolveCraftForRecipe(sim2.ctx, pid2, commRecipe, true);
    expect(ok.ok).toBe(true);
    const minted = m2.inventory.find((s) => s.itemId === QA_RARE);
    expect(minted?.instance?.signer).toBe(m2.name);
    expect(minted?.instance?.bindOnTrade).toBe(true);
    expect(m2.inventory.length).toBe(16);
  });

  it('models the masterwork split for resultCount > 1: the plain remainder needs its own home', () => {
    const mwX2: ProfessionRecipeRecord = {
      ...qaMwRecipe,
      id: '__cap_qa_mw_recipe_x2',
      resultCount: 2,
    } as ProfessionRecipeRecord;
    // One free slot, output stack at cap: the plain shape fits (both copies
    // land in the free slot), but a proc's shape is instance + ONE plain
    // remainder, needing two homes. The gate must model the remainder, not
    // just the instance.
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 13);
    m.inventory.push({ itemId: QA_MW, count: stackSizeOf(ITEMS[QA_MW]) }); // full stack: no top-up room
    m.inventory.push({ itemId: 'spider_leg', count: 2 });
    expect(m.inventory.length).toBe(15); // one free slot
    const { result: denied, draws } = countDraws(sim, () =>
      resolveCraftForRecipe(sim.ctx, pid, mwX2),
    );
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    // Two free slots: instance + remainder both fit, the craft goes through.
    const sim2 = makeSim(17);
    const pid2 = sim2.playerId;
    const m2 = setBags(sim2, pid2, 12);
    m2.inventory.push({ itemId: QA_MW, count: stackSizeOf(ITEMS[QA_MW]) });
    m2.inventory.push({ itemId: 'spider_leg', count: 2 });
    const ok = resolveCraftForRecipe(sim2.ctx, pid2, mwX2);
    expect(ok.ok).toBe(true);
    expect(m2.inventory.length).toBeLessThanOrEqual(bagCapacity(m2.bags));
  });
});

describe('salvage capacity gate (#2350)', () => {
  it('denies when the consumed copy frees no slot and the yield has no home', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    // A legacy overstacked slot: consuming one copy leaves the slot occupied.
    m.inventory.push({ itemId: SWORD, count: 2 });
    const { result, draws } = countDraws(sim, () => resolveSalvage(sim.ctx, pid, SWORD));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    expect(sim.countItem(SWORD, pid)).toBe(2);
    expect(sim.countItem('bone_fragments', pid)).toBe(0);
    expect(m.inventory.length).toBe(16);
  });

  it('succeeds at full bags when consuming the piece frees the slot the yield lands in', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15, [SWORD]);
    expect(m.inventory.length).toBe(16);
    const result = resolveSalvage(sim.ctx, pid, SWORD);
    expect(result.ok).toBe(true);
    expect(sim.countItem('bone_fragments', pid)).toBe(result.count);
    expect(m.inventory.length).toBeLessThanOrEqual(16);
  });

  it('models the WORST-CASE yield: room for one less than the max still denies, room for the max fits', () => {
    const worst = maxSalvageYield(ITEMS[SWORD]);
    const stack = stackSizeOf(ITEMS.bone_fragments);
    const denySim = makeSim();
    const denyPid = denySim.playerId;
    const dm = setBags(denySim, denyPid, 14);
    dm.inventory.push({ itemId: SWORD, count: 2 });
    dm.inventory.push({ itemId: 'bone_fragments', count: stack - (worst - 1) });
    const { result: denied, draws } = countDraws(denySim, () =>
      resolveSalvage(denySim.ctx, denyPid, SWORD),
    );
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    const okSim = makeSim(13);
    const okPid = okSim.playerId;
    const om = setBags(okSim, okPid, 14);
    om.inventory.push({ itemId: SWORD, count: 2 });
    om.inventory.push({ itemId: 'bone_fragments', count: stack - worst });
    const ok = resolveSalvage(okSim.ctx, okPid, SWORD);
    expect(ok.ok).toBe(true);
    expect(om.inventory.length).toBeLessThanOrEqual(16);
  });
});

describe('disenchant capacity gate (#2350)', () => {
  it('denies a rare piece at truly full bags: two grants, only one freed slot; nothing consumed, no draw', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15, [QA_RARE]);
    const { result, draws } = countDraws(sim, () => resolveDisenchant(sim.ctx, pid, QA_RARE));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    expect(sim.countItem(QA_RARE, pid)).toBe(1);
    expect(sim.countItem('arcane_essence', pid)).toBe(0);
    expect(m.inventory.length).toBe(16);
  });

  it('fits with one free slot: the primary takes the freed slot, the secondary the free one', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14, [QA_RARE]);
    const result = resolveDisenchant(sim.ctx, pid, QA_RARE);
    expect(result.ok).toBe(true);
    expect(sim.countItem('arcane_essence', pid)).toBe(1);
    const secondary = m.inventory.find((s) => s.itemId === 'resonant_steel');
    expect(secondary?.instance?.bindOnTrade).toBe(true);
    expect(m.inventory.length).toBeLessThanOrEqual(16);
  });

  it('pre-fits TWO epic secondaries where a rare needs exactly one (the worst-case boundary)', () => {
    const steelStack = stackSizeOf(ITEMS.resonant_steel);
    // Shared shape: full bags where consuming the piece frees one slot (the
    // primary's home) and the byte-equal bound-secondary stack has room for
    // exactly ONE more copy.
    const build = (sim: Sim, pid: number, piece: string) => {
      const m = setBags(sim, pid, 13, [piece]);
      m.inventory.push({
        itemId: 'resonant_steel',
        count: steelStack - 1,
        instance: { bindOnTrade: true },
      });
      m.inventory.push({ itemId: FILLER, count: 1 });
      expect(m.inventory.length).toBe(16);
      return m;
    };
    const epicSim = makeSim();
    const epicPid = epicSim.playerId;
    build(epicSim, epicPid, QA_EPIC);
    const { result: denied, draws } = countDraws(epicSim, () =>
      resolveDisenchant(epicSim.ctx, epicPid, QA_EPIC),
    );
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    const rareSim = makeSim(14);
    const rarePid = rareSim.playerId;
    const rm = build(rareSim, rarePid, QA_RARE);
    const ok = resolveDisenchant(rareSim.ctx, rarePid, QA_RARE);
    expect(ok.ok).toBe(true);
    expect(ok.secondaryCount).toBe(1);
    expect(rm.inventory.length).toBeLessThanOrEqual(16);
  });

  it('a sub-rare piece at full bags still disenchants: the freed slot absorbs the dust', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15, [SWORD]);
    const result = resolveDisenchant(sim.ctx, pid, SWORD);
    expect(result.ok).toBe(true);
    expect(sim.countItem('arcane_dust', pid)).toBe(result.count);
    expect(m.inventory.length).toBeLessThanOrEqual(16);
  });

  it('models the sub-rare WORST-CASE yield: dust room one short of the max still denies, room for the max fits', () => {
    const worst = maxDisenchantYield(ITEMS[SWORD]);
    const stack = stackSizeOf(ITEMS.arcane_dust);
    const denySim = makeSim();
    const denyPid = denySim.playerId;
    const dm = setBags(denySim, denyPid, 14);
    dm.inventory.push({ itemId: SWORD, count: 2 }); // overstacked victim: frees nothing
    dm.inventory.push({ itemId: 'arcane_dust', count: stack - (worst - 1) });
    const { result: denied, draws } = countDraws(denySim, () =>
      resolveDisenchant(denySim.ctx, denyPid, SWORD),
    );
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    const okSim = makeSim(15);
    const okPid = okSim.playerId;
    const om = setBags(okSim, okPid, 14);
    om.inventory.push({ itemId: SWORD, count: 2 });
    om.inventory.push({ itemId: 'arcane_dust', count: stack - worst });
    const ok = resolveDisenchant(okSim.ctx, okPid, SWORD);
    expect(ok.ok).toBe(true);
    expect(om.inventory.length).toBeLessThanOrEqual(16);
  });
});

// The worst-case reservation terms the gates pre-fit, pinned against the real
// rolled yields with fixed rng arms so the gate-side max and the grant-side
// roll cannot drift apart in lockstep (the self-referential-pin trap: the
// boundary tests above size their fixtures WITH maxSalvageYield /
// maxDisenchantYield, so this pin is the independent anchor).
describe('worst-case yield pins (#2350)', () => {
  const fixedRng = (roll: number) => ({ next: () => roll }) as unknown as Rng;

  it('salvageYield never exceeds maxSalvageYield, and the max is reachable (the +1 bonus arm)', () => {
    const def = ITEMS[SWORD];
    const withoutBonus = salvageYield(def, fixedRng(0)); // roll < 0.5: no bonus
    const withBonus = salvageYield(def, fixedRng(0.9)); // roll >= 0.5: the +1 arm
    expect(withBonus).toBe(maxSalvageYield(def));
    expect(withoutBonus).toBe(maxSalvageYield(def) - 1);
  });

  it('disenchantYield never exceeds maxDisenchantYield, and the max is reachable', () => {
    const def = ITEMS[SWORD];
    const withoutBonus = disenchantYield(def, fixedRng(0));
    const withBonus = disenchantYield(def, fixedRng(0.9));
    expect(withBonus).toBe(maxDisenchantYield(def));
    expect(withoutBonus).toBe(maxDisenchantYield(def) - 1);
  });
});

describe('apply-enchant capacity gate (#2350)', () => {
  it('denies when the victim comes from a multi-copy slot and nothing frees a home for the instance', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    m.inventory.push({ itemId: SWORD, count: 2 }); // legacy overstack: frees nothing
    m.inventory.push({ itemId: 'arcane_dust', count: 10 }); // 5 remain: keeps its slot
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(sim.countItem(SWORD, pid)).toBe(2);
    expect(sim.countItem('arcane_dust', pid)).toBe(10);
    expect(m.inventory.length).toBe(16);
  });

  it('succeeds when the consumed copy frees the slot the enchanted instance lands in', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14, [SWORD]);
    m.inventory.push({ itemId: 'arcane_dust', count: 10 });
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);
    expect(result.ok).toBe(true);
    const enchanted = m.inventory.find((s) => s.itemId === SWORD && s.instance?.enchant);
    expect(enchanted?.instance?.enchant).toBe(ENCHANT);
    expect(m.inventory.length).toBe(16);
  });

  it('models the reagents leaving: a fully-consumed reagent stack frees the needed slot', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    m.inventory.push({ itemId: SWORD, count: 2 });
    m.inventory.push({ itemId: 'arcane_dust', count: 5 }); // exactly the cost: slot frees
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);
    expect(result.ok).toBe(true);
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
    expect(m.inventory.length).toBe(16);
  });

  // The #2415 replace arm's gate, same #2350/#2139 discipline: the scratch
  // model consumes the SAME pinned enchanted victim the live path does
  // (consumeEnchantedVictim on both sides), so the freed slot is modeled and a
  // full pack still replaces; only a surviving multi-unit victim stack that
  // frees nothing can genuinely deny.
  it('replace succeeds with COMPLETELY full bags: the consumed victim frees the home the mint lands in', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    m.inventory.push({
      itemId: SWORD,
      count: 1,
      instance: { enchant: 'enchant_weapon_agility', rolled: { stats: { agi: 2 } } },
    });
    m.inventory.push({ itemId: 'arcane_dust', count: 5 }); // exactly the cost: slot frees
    expect(m.inventory.length).toBe(17); // > the 16-slot budget: zero headroom
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT, undefined, true);
    expect(result.ok).toBe(true);
    const replaced = m.inventory.find((s) => s.itemId === SWORD);
    expect(replaced?.instance?.enchant).toBe(ENCHANT);
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
  });

  it('replace denies no_bag_space when the victim leaves a SURVIVING stack and nothing frees a home', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    // A legacy-overstack style slot: two identical enchanted units share one
    // slot, so consuming one unit frees NOTHING, and the replaced copy (a
    // different payload) cannot merge back into it.
    m.inventory.push({
      itemId: SWORD,
      count: 2,
      instance: { enchant: 'enchant_weapon_agility', rolled: { stats: { agi: 2 } } },
    });
    m.inventory.push({ itemId: 'arcane_dust', count: 10 }); // 5 remain: keeps its slot
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    // Zero side effects on the deny: stack, reagents, and slots untouched.
    expect(sim.countItem(SWORD, pid)).toBe(2);
    expect(sim.countItem('arcane_dust', pid)).toBe(10);
    expect(m.inventory.length).toBe(16);
    const stack = m.inventory.find((s) => s.itemId === SWORD);
    expect(stack?.instance?.enchant).toBe('enchant_weapon_agility');
  });
});

describe('unbind split capacity gate (#2350)', () => {
  it('denies splitting a bound stack at full bags: no fee charged, nothing cleared', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    m.inventory.push({ itemId: SWORD, count: 2, instance: { bindOnTrade: true, boundTo: 999 } });
    m.copper = 100000;
    standAtStation(sim, pid);
    const result = unbindItem(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbind_no_space');
    expect(m.copper).toBe(100000);
    const slot = m.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.count).toBe(2);
    expect(slot?.instance?.boundTo).toBe(999);
    expect(m.inventory.length).toBe(16);
  });

  it('a single bound copy still unbinds in place at full bags (no room needed)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 15);
    m.inventory.push({ itemId: SWORD, count: 1, instance: { bindOnTrade: true, boundTo: 999 } });
    m.copper = 100000;
    standAtStation(sim, pid);
    const result = unbindItem(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(true);
    expect(m.copper).toBe(100000 - result.fee);
    const slot = m.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.boundTo).toBeUndefined();
    expect(slot?.instance?.bindOnTrade).toBe(true);
    expect(m.inventory.length).toBe(16);
  });

  it('splits at FULL bags when the freed copy merges into an existing unbound armed stack', () => {
    // The gate models the grant with the exact freed payload (bindOnTrade
    // kept, boundTo removed), so byte-equal stack room counts as fitting even
    // with zero free slots. Needs the synthetic stackable blade: real
    // equipment stacks one per slot, which makes this arm unreachable in
    // shipped content.
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    m.inventory.push({
      itemId: QA_STACK_WEAPON,
      count: 2,
      instance: { bindOnTrade: true, boundTo: 999 },
    });
    m.inventory.push({ itemId: QA_STACK_WEAPON, count: 2, instance: { bindOnTrade: true } });
    m.copper = 100000;
    standAtStation(sim, pid);
    expect(m.inventory.length).toBe(16);
    const result = unbindItem(sim.ctx, QA_STACK_WEAPON, pid);
    expect(result.ok).toBe(true);
    const bound = m.inventory.find(
      (s) => s.itemId === QA_STACK_WEAPON && s.instance?.boundTo !== undefined,
    );
    const unbound = m.inventory.find(
      (s) => s.itemId === QA_STACK_WEAPON && s.instance?.boundTo === undefined,
    );
    expect(bound?.count).toBe(1);
    expect(unbound?.count).toBe(3); // the freed copy merged, no new slot
    expect(m.inventory.length).toBe(16);
  });

  it('splits with a free slot: one unbound copy peels off, the rest stay bound', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = setBags(sim, pid, 14);
    m.inventory.push({ itemId: SWORD, count: 2, instance: { bindOnTrade: true, boundTo: 999 } });
    m.copper = 100000;
    standAtStation(sim, pid);
    const result = unbindItem(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(true);
    const bound = m.inventory.find((s) => s.itemId === SWORD && s.instance?.boundTo !== undefined);
    const freed = m.inventory.find((s) => s.itemId === SWORD && s.instance?.boundTo === undefined);
    expect(bound?.count).toBe(1);
    expect(freed?.count).toBe(1);
    expect(freed?.instance?.bindOnTrade).toBe(true);
    expect(m.inventory.length).toBe(16);
  });
});

// #2446 review coverage gap: the #1149 signing rule's capacity-gate shape
// (the `shapes` array in resolveCraftForRecipe) has to model the SAME signed
// instance the grant arm below it mints, or a stale plain shape passes the
// gate for an output the grant then cannot fit (addItemInstance applies no
// cap of its own). A signed instance never tops up a plain stack of the same
// item (different payload), so a bag whose only free room is a plain stack
// of the output must deny, exactly the case a regression to the old plain
// shape would silently pass.
describe('rare-quality signing composes with the capacity gate (#2446 review coverage)', () => {
  it('denies a rare-quality resultCount>1 craft when the only room is a same-item PLAIN stack', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // 11 filler slots + 1 plain output stack + 4 reagent slots = 16 (full).
    const m = setBags(sim, pid, 11);
    // The plain (unsigned) stack of the craft's own output. The OLD
    // `recipe.resultCount === 1` gated shape modeled a plain grant here and
    // found this slot a valid top-up target, so it fit. The signed shape
    // this PR ships needs its own slot and must deny.
    m.inventory.push({ itemId: 'anglers_feast_platter', count: 1 });
    m.copper = 100000;
    m.knownRecipes.add('recipe_anglers_feast_platter');
    m.craftSkills.cooking = 50;
    standAtStationType(sim, pid, 'kitchens');
    // One extra of each reagent beyond what the recipe consumes, so
    // consuming the required amount leaves each stack non-empty and the
    // reagent slots do NOT free up. Otherwise the freed reagent slots would
    // give the output room regardless of shape, and the test would not
    // distinguish the old plain shape from the new signed one.
    for (const [itemId, count] of [
      ['raw_frostgill_trout', 3],
      ['raw_bog_eel', 3],
      ['sunpetal_herb', 2],
      ['cooking_salt', 3],
    ] as const) {
      m.inventory.push({ itemId, count });
    }
    expect(bagCapacity(m.bags)).toBe(16);
    expect(m.inventory.length).toBe(16);

    const result = resolveCraft(sim.ctx, pid, 'recipe_anglers_feast_platter');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    // No side effects: the reagents and the pre-existing plain stack survive
    // untouched, and no output was minted.
    expect(sim.countItem('anglers_feast_platter', pid)).toBe(1);
    expect(sim.countItem('raw_frostgill_trout', pid)).toBe(3);
    expect(m.copper).toBe(100000);
  });
});
