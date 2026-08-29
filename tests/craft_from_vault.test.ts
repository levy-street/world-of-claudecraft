// Crafting from the Materials Vault: the two-pool consumption matrix.
//
// THE BAGS ARE SPENT FIRST, ALWAYS, per reagent. The vault is the deep
// stockpile and the bags are what you are holding, so a full vault never
// changes what a bags-only craft costs and a stockpile never drains while the
// same material sits in the player's own inventory.
//
// Four call sites make the identical sourcing decision (the availability
// check, the #2350 bag-capacity scratch gate, the real consumption, and the
// Create All batch simulation) and they all route through
// professions/reagent_sources.ts planReagentSourceDraw. The cases below drive
// the REAL craft path and pin the survivors on BOTH sides as exact literals,
// because the failure mode this feature can produce is a gate and a
// consumption that disagree: the player either pays twice or is refused a
// craft they can afford.
//
// Two rules earn their own sections because they are the easy ones to get
// wrong:
// - A vault-sourced unit NEVER SAT IN A BAG, so it frees no bag space. A
//   capacity gate that modeled it as a bag removal would over-credit room and
//   admit a craft whose output has nowhere to land.
// - Inside a blocked context the vault is INVISIBLE: carried-insufficient plus
//   vault-sufficient denies with insufficient_materials, draws nothing, and
//   leaves the vault byte-identical.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { recipeById } from '../src/sim/content/recipes';
import { DUNGEON_X_THRESHOLD, DUNGEONS, instanceOrigin, QUESTS, RIFT_X_MIN } from '../src/sim/data';
import { INSTANCE_FOOTPRINT_HALF_WIDTH, instanceInfoAt } from '../src/sim/instances/dungeons';
import { consumeVaultStock, type MaterialsVaultState } from '../src/sim/materials_vault';
import {
  hasRecipeMaterials,
  maxCraftCountForRecipe,
  resolveCraft,
  resolveCraftForRecipe,
} from '../src/sim/professions/crafting';
import {
  evaluateApplyEnchantAdmission,
  resolveApplyEnchant,
} from '../src/sim/professions/enchanting';
import { planReagentSourceDraw } from '../src/sim/professions/reagent_sources';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, InvSlot } from '../src/sim/types';
import { claimWestReach, vaultDrawBlocked } from '../src/sim/vault_craft_gate';
import {
  leaveBattleground,
  placeInBattleground,
  placeInDungeon,
  placeInOpenWorld,
} from './helpers/instanced_contexts';

const JERKY = 'recipe_tough_jerky'; // 1 spider_leg -> 1 tough_jerky, no station
const VEST = 'recipe_eastbrook_chain_vest'; // 4 copper_ore + 9 smithing_flux
const FILLER = 'simple_fishing_pole'; // one per slot, merges with nothing
const SWORD = 'eastbrook_arming_sword'; // common mainhand weapon
const ENCHANT = 'enchant_weapon_might'; // mainhand, 5 arcane_dust, str +2
const REPLACED_ENCHANT = 'enchant_weapon_agility'; // a second mainhand enchant, also 5 dust

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number = sim.playerId): PlayerMeta {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing meta ${pid}`);
  return meta;
}

function entityOf(sim: Sim, pid: number = sim.playerId): Entity {
  const e = sim.ctx.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  return e;
}

/** Seed vault stock the way tests/materials_vault.test.ts does: straight onto
 *  the player's own live state, no banker and no deposit command in the way. */
function seedVault(sim: Sim, rows: Record<string, number>, pid: number = sim.playerId): void {
  Object.assign(metaOf(sim, pid).vault.stock, rows);
}

function vaultOf(sim: Sim, pid: number = sim.playerId): Record<string, number> {
  return metaOf(sim, pid).vault.stock;
}

/** Key ORDER and value included, and NaN/Infinity survive the round trip
 *  (JSON.stringify would flatten both to null): the byte-identical probe every
 *  "the vault was not touched" assertion below compares. */
function fingerprint(stock: Record<string, number>): string {
  return Object.keys(stock)
    .map((key) => `${key}=${String(stock[key])}`)
    .join(',');
}

function grant(sim: Sim, itemId: string, count: number, pid: number = sim.playerId): void {
  sim.addItem(itemId, count, pid);
}

/** Replace the inventory with `fillerSlots` unmergeable singles plus `extras`
 *  (the professions_capacity.test.ts idiom). */
function setBags(
  sim: Sim,
  fillerSlots: number,
  extras: InvSlot[] = [],
  pid: number = sim.playerId,
): PlayerMeta {
  const meta = metaOf(sim, pid);
  meta.inventory = [
    ...Array.from({ length: fillerSlots }, () => ({ itemId: FILLER, count: 1 })),
    ...extras,
  ];
  return meta;
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

/** Every rng VALUE the call drew, in order. A draw COUNT alone cannot see two
 *  streams that drew the same number of times in a different order or from a
 *  different position, which is exactly what a sourcing change could disturb. */
function recordDraws<T>(sim: Sim, fn: () => T): { result: T; values: number[] } {
  const values: number[] = [];
  sim.ctx.rng.setObserver((value) => {
    values.push(value);
  });
  try {
    return { result: fn(), values };
  } finally {
    sim.ctx.rng.setObserver(null);
  }
}

/** Finish exactly ONE running craft cast (the updateCasting shape). Returns
 *  the craftResult events that completion produced, including the follow-on
 *  cast's own denial when a batch stops. */
function completeOneCraft(
  sim: Sim,
  pid: number = sim.playerId,
): { ok: boolean; reason?: string }[] {
  const p = entityOf(sim, pid);
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeCraftCast(p, metaOf(sim, pid));
  return sim
    .drainEvents()
    .filter((ev): ev is Extract<typeof ev, { type: 'craftResult' }> => ev.type === 'craftResult')
    .map((ev) => ({ ok: ev.ok, reason: ev.reason }));
}

/** A counting callback over a plain holdings record, the shape both tiers of
 *  planReagentSourceDraw take. */
function counter(rows: Record<string, number>): (id: string) => number {
  return (id: string) => rows[id] ?? 0;
}

/** Drive a real batch through the cast chain: craftItem arms the first cast,
 *  and each complete auto-starts the next while the batch has items left. */
function runCraftBatch(
  sim: Sim,
  recipeId: string,
  count: number,
  pid: number = sim.playerId,
): number {
  const p = entityOf(sim, pid);
  const meta = metaOf(sim, pid);
  sim.craftItem(recipeId, false, pid, count);
  let completed = 0;
  while (p.craftCastRecipeId !== '' && completed < count + 2) {
    p.castingAbility = null;
    p.castRemaining = 0;
    sim.ctx.completeCraftCast(p, meta);
    completed += 1;
  }
  return completed;
}

// ---------------------------------------------------------------------------
// Premise pins: if the content below is re-specced, every literal in this file
// stops meaning what it says, and these fail first with a readable reason.
// ---------------------------------------------------------------------------
describe('fixture premises', () => {
  it('pins the two recipes and the one grade ladder this suite spends', () => {
    expect(recipeById(JERKY)?.reagents).toEqual([{ itemId: 'spider_leg', count: 1 }]);
    expect(recipeById(JERKY)?.resultItemId).toBe('tough_jerky');
    expect(recipeById(VEST)?.reagents).toEqual([
      { itemId: 'copper_ore', count: 4 },
      { itemId: 'smithing_flux', count: 9 },
    ]);
    // copper_ore is the graded reagent (base then fine); the other two are
    // single-id, which is what makes the grade cases below readable.
    expect(recipeById(VEST)?.resultItemId).toBe('eastbrook_chain_vest');
  });

  it('starts every player in the open world with an empty vault', () => {
    const sim = makeSim();
    expect(vaultOf(sim)).toEqual({});
    expect(bagCapacity(metaOf(sim).bags)).toBe(16);
  });

  it('routes every sourcing decision through ONE planner per file', () => {
    // A SECOND implementation of the carried-first order is a defect, not an
    // optimization: the moment two sites disagree the player either pays twice
    // or is refused a craft they can afford. The behavioural cases in this
    // file all exercise the shared planner, so a rogue open-coded walk added
    // beside it would not turn any of them red. This counts the call sites
    // instead, so a new one has to show up here as an unexplained extra.
    //
    // Comments are blanked (line structure preserved) so a comment naming a
    // planner cannot be counted as a call.
    const strip = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const read = (rel: string): string =>
      strip(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
    const occurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;

    const craft = read('../src/sim/professions/crafting.ts');
    const enchant = read('../src/sim/professions/enchanting.ts');

    // One declaration plus its call sites. crafting.ts has FIVE sites (the
    // availability check, the lock-only denial probe from the v0.40.0
    // item-lock merge, which re-plans with locked copies counted, the
    // capacity scratch, the real consumption, and the batch simulation);
    // enchanting.ts has SIX (three resolve arms and three admission arms).
    expect(occurrences(craft, 'function planCraftReagentDraw(')).toBe(1);
    expect(occurrences(craft, 'planCraftReagentDraw(')).toBe(6);
    expect(occurrences(enchant, 'function planEnchantReagentDraw(')).toBe(1);
    expect(occurrences(enchant, 'planEnchantReagentDraw(')).toBe(7);

    // And each file-local planner is a thin wrapper over the ONE shared
    // carried-first implementation, called exactly once per file.
    expect(occurrences(craft, 'planReagentSourceDraw(')).toBe(1);
    expect(occurrences(enchant, 'planReagentSourceDraw(')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// planReagentSourceDraw: the one implementation of the carried-first order.
// ---------------------------------------------------------------------------
describe('planReagentSourceDraw', () => {
  it('takes what the bags hold first and covers the remainder from the vault', () => {
    const plan = planReagentSourceDraw(
      'copper_ore',
      4,
      counter({ copper_ore: 3 }),
      counter({ copper_ore: 10 }),
    );
    expect(plan.carried).toEqual([{ itemId: 'copper_ore', count: 3 }]);
    expect(plan.vault).toEqual([{ itemId: 'copper_ore', count: 1 }]);
    expect(plan.planned).toBe(4);
    expect(plan.shortfall).toBe(0);
  });

  it('exhausts the WHOLE carried grade walk before one vault unit is planned', () => {
    // Decisive for the tier boundary: a plan that switched to the vault after
    // the base grade ran out would leave the fine copy in the bags and take 3
    // from the vault instead of 2.
    const plan = planReagentSourceDraw(
      'copper_ore',
      4,
      counter({ copper_ore: 1, fine_copper_ore: 1 }),
      counter({ copper_ore: 10 }),
    );
    expect(plan.carried).toEqual([
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'fine_copper_ore', count: 1 },
    ]);
    expect(plan.vault).toEqual([{ itemId: 'copper_ore', count: 2 }]);
    expect(plan.shortfall).toBe(0);
  });

  it('walks the SAME grade order inside the vault: base first, fine after', () => {
    const plan = planReagentSourceDraw(
      'copper_ore',
      4,
      counter({}),
      counter({ copper_ore: 2, fine_copper_ore: 10 }),
    );
    expect(plan.carried).toEqual([]);
    expect(plan.vault).toEqual([
      { itemId: 'copper_ore', count: 2 },
      { itemId: 'fine_copper_ore', count: 2 },
    ]);
    expect(plan.shortfall).toBe(0);
  });

  it('is grade-BLIND when the caller passes an explicit single-id ladder', () => {
    // The enchant shape: exact item id only. Neither tier may reach the fine
    // grade, even though both pools are full of it.
    const plan = planReagentSourceDraw(
      'copper_ore',
      2,
      counter({ fine_copper_ore: 10 }),
      counter({ fine_copper_ore: 10 }),
      ['copper_ore'],
    );
    expect(plan.carried).toEqual([]);
    expect(plan.vault).toEqual([]);
    expect(plan.planned).toBe(0);
    expect(plan.shortfall).toBe(2);
  });

  it('reports the exact shortfall when both pools together fall short', () => {
    const plan = planReagentSourceDraw(
      'copper_ore',
      5,
      counter({ copper_ore: 1 }),
      counter({ copper_ore: 1 }),
    );
    // The takes are still planned: the caller gates on shortfall, not on an
    // empty plan.
    expect(plan.carried).toEqual([{ itemId: 'copper_ore', count: 1 }]);
    expect(plan.vault).toEqual([{ itemId: 'copper_ore', count: 1 }]);
    expect(plan.planned).toBe(2);
    expect(plan.shortfall).toBe(3);
  });

  it('plans no vault tier at all when vaultCount is null', () => {
    // The byte-identical-to-before path: exactly what the carried-only walk
    // produced before the two-pool mechanic landed.
    const plan = planReagentSourceDraw('copper_ore', 4, counter({ copper_ore: 1 }), null);
    expect(plan.carried).toEqual([{ itemId: 'copper_ore', count: 1 }]);
    expect(plan.vault).toEqual([]);
    expect(plan.shortfall).toBe(3);
  });

  it('hands out ONE frozen empty-plan singleton, shared by both tiers', () => {
    // The empty plan is handed out BY REFERENCE, so a caller that mutated it
    // would poison every later empty plan in the process. Frozen is what makes
    // the sharing safe, and the sharing is deliberate rather than incidental,
    // so both halves are pinned here.
    const zero = planReagentSourceDraw('copper_ore', 0, counter({}), null);
    expect(Object.isFrozen(zero.carried)).toBe(true);
    expect(zero.vault).toBe(zero.carried); // both tiers, one object

    const negative = planReagentSourceDraw('spider_leg', -1, counter({}), null);
    expect(negative.carried).toBe(zero.carried); // and one object across calls

    // The no-vault-tier arm of a REAL plan reaches for the same singleton.
    const noVaultTier = planReagentSourceDraw('copper_ore', 4, counter({ copper_ore: 4 }), null);
    expect(noVaultTier.carried).not.toHaveLength(0); // premise: a real plan
    expect(noVaultTier.vault).toBe(zero.carried);
  });

  it('returns the empty plan for a non-positive requirement', () => {
    for (const required of [0, -1]) {
      const plan = planReagentSourceDraw(
        'copper_ore',
        required,
        counter({ copper_ore: 9 }),
        counter({ copper_ore: 9 }),
      );
      expect(plan.carried, `required ${required}`).toEqual([]);
      expect(plan.vault, `required ${required}`).toEqual([]);
      expect(plan.planned, `required ${required}`).toBe(0);
      expect(plan.shortfall, `required ${required}`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The consumption order, through the real craft path.
// ---------------------------------------------------------------------------
describe('craft consumption spends the bags before the vault', () => {
  it('drains the carried copies to zero before ONE vault unit moves', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 3, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    // 4 needed, 3 carried: the bags go to zero and the vault pays exactly 1.
    // Vault-first would have left 3 in the bags and 6 in the vault.
    expect(sim.countItem('copper_ore', pid)).toBe(0);
    expect(vaultOf(sim, pid).copper_ore).toBe(9);
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
  });

  it('leaves the vault byte-identical when the bags cover the whole recipe', () => {
    // A full vault never changes what a bags-only craft costs.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 4, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10, smithing_flux: 10 }, pid);
    const before = fingerprint(vaultOf(sim, pid));

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    expect(fingerprint(vaultOf(sim, pid))).toBe('copper_ore=10,smithing_flux=10');
    expect(metaOf(sim, pid).vaultWireRev).toBe(0);
    expect(sim.countItem('copper_ore', pid)).toBe(0);
  });

  it('crafts entirely out of the vault when the bags hold nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { copper_ore: 4, smithing_flux: 9 }, pid);

    expect(hasRecipeMaterials(sim.ctx, recipeById(VEST)!, pid)).toBe(true);
    expect(metaOf(sim, pid).vaultWireRev).toBe(0);
    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
    // Both rows were drawn to zero, so both keys are GONE (never written 0).
    expect(Object.hasOwn(vaultOf(sim, pid), 'copper_ore')).toBe(false);
    expect(Object.hasOwn(vaultOf(sim, pid), 'smithing_flux')).toBe(false);
    expect(vaultOf(sim, pid)).toEqual({});
    expect(metaOf(sim, pid).vaultWireRev).toBe(2); // one immediate bump per live row decrement
  });

  it('a row drawn to zero is DELETED, and a partly spent row keeps its count', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { copper_ore: 4, smithing_flux: 12 }, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(Object.hasOwn(vaultOf(sim, pid), 'copper_ore')).toBe(false);
    expect(vaultOf(sim, pid).smithing_flux).toBe(3);
  });
});

describe('craft consumption across material grades', () => {
  it('spends a carried FINE copy before drawing the base grade from the vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'fine_copper_ore', 2, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(sim.countItem('fine_copper_ore', pid)).toBe(0); // the carried tier ran out first
    expect(vaultOf(sim, pid).copper_ore).toBe(8); // then the vault paid the other 2
  });

  it('spends a carried BASE copy before drawing the fine grade from the vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 1, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { fine_copper_ore: 10 }, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(sim.countItem('copper_ore', pid)).toBe(0);
    expect(vaultOf(sim, pid).fine_copper_ore).toBe(7); // 3 drawn
  });

  it('spends the vault base grade before the vault fine grade', () => {
    // Downward substitution behaves identically in both pools: cheap grade
    // first, premium grade kept.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 2, fine_copper_ore: 10 }, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(Object.hasOwn(vaultOf(sim, pid), 'copper_ore')).toBe(false); // 2 taken, row gone
    expect(vaultOf(sim, pid).fine_copper_ore).toBe(8); // 2 taken from the premium grade
  });
});

describe('exact-boundary holdings', () => {
  it('succeeds when the two pools TOGETHER are exactly enough, spending both dry', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 1, pid);
    grant(sim, 'smithing_flux', 4, pid);
    seedVault(sim, { copper_ore: 3, smithing_flux: 5 }, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(sim.countItem('copper_ore', pid)).toBe(0);
    expect(sim.countItem('smithing_flux', pid)).toBe(0);
    expect(vaultOf(sim, pid)).toEqual({});
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
  });

  it('refuses ONE unit short across both pools, touching neither and drawing nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 1, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 2 }, pid); // 3 of the 4 needed
    const vaultBefore = fingerprint(vaultOf(sim, pid));

    expect(hasRecipeMaterials(sim.ctx, recipeById(VEST)!, pid)).toBe(false);
    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, VEST));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(draws).toBe(0);
    // Partial consumption never happens: BOTH pools are byte-identical.
    expect(sim.countItem('copper_ore', pid)).toBe(1);
    expect(sim.countItem('smithing_flux', pid)).toBe(9);
    expect(fingerprint(vaultOf(sim, pid))).toBe(vaultBefore);
    expect(fingerprint(vaultOf(sim, pid))).toBe('copper_ore=2');
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(0);
  });
});

describe('corrupt vault rows stay dormant', () => {
  // A hand-edited or future-shaped save can present zero, a negative, NaN,
  // Infinity, a fraction, or a past-precision count. Spending any of them
  // would either destroy stock or MINT items, so each stays visible,
  // recoverable, and unspendable.
  const CORRUPT: Record<string, number> = {
    copper_ore: Number.NaN,
    smithing_flux: Number.POSITIVE_INFINITY,
  };

  it('refuses a craft that could only be paid by a corrupt row', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, CORRUPT, pid);
    const before = fingerprint(vaultOf(sim, pid));

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, VEST));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(draws).toBe(0);
    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    expect(fingerprint(vaultOf(sim, pid))).toBe('copper_ore=NaN,smithing_flux=Infinity');
  });

  it('leaves every degenerate shape untouched by a craft satisfied elsewhere', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Each of the six shapes on its own key, so a filter that let one through
    // fails on that key by name.
    seedVault(
      sim,
      {
        iron_ore: Number.NaN,
        silverleaf_herb: Number.POSITIVE_INFINITY,
        spider_leg: 2.5,
        arcane_dust: -3,
        ironbark_log: 1e21,
        rough_stone: 0,
      },
      pid,
    );
    const before = fingerprint(vaultOf(sim, pid));
    grant(sim, 'copper_ore', 4, pid);
    grant(sim, 'smithing_flux', 9, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    expect(fingerprint(vaultOf(sim, pid))).toBe(
      'iron_ore=NaN,silverleaf_herb=Infinity,spider_leg=2.5,arcane_dust=-3,ironbark_log=1e+21,rough_stone=0',
    );
  });

  it('does not let a fractional row pay a craft that needs exactly its floor', () => {
    // 2.5 spider legs is not 2 spider legs: the row is dormant, not floored.
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { spider_leg: 2.5 }, pid);

    const result = resolveCraft(sim.ctx, pid, JERKY);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(vaultOf(sim, pid).spider_leg).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// TWO REAGENTS NAMING ONE MATERIAL. Each reagent line is planned separately,
// so without a tally spanning the whole recipe both lines claim the SAME
// units: the gate admits a craft that can only be half paid, and the
// consumption then either half-spends the pool or grants an output nobody paid
// for. The tally has to span both pools, because either one can be the pool
// both lines reach into.
// ---------------------------------------------------------------------------
describe('overlapping reagents cannot double-claim one pool', () => {
  // A synthetic recipe, passed straight to resolveCraftForRecipe (the
  // professions_capacity.test.ts synthetic-record idiom): no shipped recipe
  // names one material twice, and inventing content to test a planner bug
  // would be the wrong shape.
  const OVERLAP: ProfessionRecipeRecord = {
    id: '__vault_qa_overlap_recipe',
    professionId: 'cooking',
    resultItemId: 'tough_jerky',
    resultCount: 1,
    reagents: [
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'copper_ore', count: 5 },
    ],
    skillReq: 0,
    itemLevelBudget: 1,
    level: 1,
  } as ProfessionRecipeRecord;

  it('denies when the VAULT holds exactly one line worth of the ten needed', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { copper_ore: 5 }, pid);

    expect(hasRecipeMaterials(sim.ctx, OVERLAP, pid)).toBe(false);
    const { result, draws } = countDraws(sim, () => resolveCraftForRecipe(sim.ctx, pid, OVERLAP));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(draws).toBe(0);
    expect(fingerprint(vaultOf(sim, pid))).toBe('copper_ore=5'); // byte-identical
    expect(sim.countItem('tough_jerky', pid)).toBe(0);
  });

  it('denies when the BAGS hold exactly one line worth of the ten needed', () => {
    // The same double-claim in the other pool: the carried tier is read live
    // per line, so the second line must not see units the first one claimed.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 5, pid);

    expect(hasRecipeMaterials(sim.ctx, OVERLAP, pid)).toBe(false);
    const { result, draws } = countDraws(sim, () => resolveCraftForRecipe(sim.ctx, pid, OVERLAP));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(draws).toBe(0);
    expect(sim.countItem('copper_ore', pid)).toBe(5); // no partial consumption
    expect(sim.countItem('tough_jerky', pid)).toBe(0);
  });

  it('CONTROL: ten in the vault admits and spends exactly ten', () => {
    // Without this the two denials above would pass on a recipe that could
    // never be crafted at all.
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { copper_ore: 10 }, pid);

    expect(hasRecipeMaterials(sim.ctx, OVERLAP, pid)).toBe(true);
    const result = resolveCraftForRecipe(sim.ctx, pid, OVERLAP);

    expect(result.ok).toBe(true);
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
    expect(Object.hasOwn(vaultOf(sim, pid), 'copper_ore')).toBe(false); // all ten
  });

  it('CONTROL: five carried plus five vaulted admits and spends both dry', () => {
    // The tally has to span the pools, not just tally within each: line one is
    // paid from the bags, line two from the vault.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 5, pid);
    seedVault(sim, { copper_ore: 5 }, pid);

    const result = resolveCraftForRecipe(sim.ctx, pid, OVERLAP);

    expect(result.ok).toBe(true);
    expect(sim.countItem('copper_ore', pid)).toBe(0);
    expect(vaultOf(sim, pid)).toEqual({});
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
  });
});

describe('consumeVaultStock refuses any draw the row cannot pay in full', () => {
  it('returns false and mutates nothing for every degenerate draw', () => {
    // The apply half of the two-pool mechanic, driven directly: partial spends
    // do not exist here, because a half-spent line is the partial-consumption
    // defect the craft path denies precisely to avoid.
    const corrupt: MaterialsVaultState = { stock: { copper_ore: 2.5 }, special: [], upgrades: 0 };
    expect(consumeVaultStock(corrupt, 'copper_ore', 2)).toBe(false);
    expect(corrupt.stock.copper_ore).toBe(2.5); // dormant, not floored

    const sane: MaterialsVaultState = { stock: { copper_ore: 4 }, special: [], upgrades: 0 };
    expect(consumeVaultStock(sane, 'copper_ore', 5)).toBe(false); // more than held
    expect(consumeVaultStock(sane, 'copper_ore', 0)).toBe(false);
    expect(consumeVaultStock(sane, 'copper_ore', -1)).toBe(false);
    expect(consumeVaultStock(sane, 'copper_ore', 1.5)).toBe(false);
    expect(consumeVaultStock(sane, 'spider_leg', 1)).toBe(false); // no such row
    expect(sane.stock.copper_ore).toBe(4); // not one of them moved a unit

    // CONTROL: the sane draw succeeds, and reaching zero deletes the key.
    expect(consumeVaultStock(sane, 'copper_ore', 4)).toBe(true);
    expect(Object.hasOwn(sane.stock, 'copper_ore')).toBe(false);
  });

  it('grants no output when a corrupt vault row is the only thing left to pay', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 2, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 2.5 }, pid); // would cover the other 2 if spendable

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, VEST));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(draws).toBe(0);
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(0); // nothing minted
    expect(sim.countItem('copper_ore', pid)).toBe(2); // nothing spent
    expect(sim.countItem('smithing_flux', pid)).toBe(9);
    expect(vaultOf(sim, pid).copper_ore).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// THE CAPACITY TRAP: a vault-sourced unit frees no bag space.
// ---------------------------------------------------------------------------
describe('bag capacity: vault-sourced reagents free NO room', () => {
  it('CONTROL: a full pack still crafts when the CARRIED reagent frees the slot', () => {
    // professions_capacity.test.ts:179-189, restated so the vault arm below is
    // a genuine A/B and not a test that never could have passed.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(sim, 15, [{ itemId: 'spider_leg', count: 1 }], pid);
    expect(meta.inventory.length).toBe(16);

    expect(resolveCraft(sim.ctx, pid, JERKY).ok).toBe(true);

    expect(sim.countItem('tough_jerky', pid)).toBe(1);
    expect(meta.inventory.length).toBe(16);
  });

  it('REFUSES the same craft when the reagent comes from the vault instead', () => {
    // The trap: the reagent never sat in a bag, so nothing is freed and the
    // output has nowhere to land. A scratch that applied the vault take as a
    // bag removal would admit this and overflow the pack.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(sim, 16, [], pid);
    seedVault(sim, { spider_leg: 1 }, pid);
    expect(meta.inventory.length).toBe(16);

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    expect(meta.inventory.length).toBe(16);
    expect(sim.countItem('tough_jerky', pid)).toBe(0);
    expect(vaultOf(sim, pid).spider_leg).toBe(1); // nothing consumed anywhere
  });

  it('keeps the #2446 no-freed-slot control refused with a full vault behind it', () => {
    // The reagent is held as a partial stack, so consuming one frees nothing.
    // A vault full of the same material must not change that answer (the
    // carried tier covers the requirement, so the vault is never even
    // reached).
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(sim, 15, [{ itemId: 'spider_leg', count: 2 }], pid);
    seedVault(sim, { spider_leg: 20 }, pid);

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(draws).toBe(0);
    expect(sim.countItem('spider_leg', pid)).toBe(2);
    expect(vaultOf(sim, pid).spider_leg).toBe(20);
    expect(meta.inventory.length).toBe(16);
  });

  it('still succeeds when a CARRIED take frees the room and the vault only tops up', () => {
    // The mixed case the two rules meet in. Exactly ONE slot frees: the copper
    // stack empties, while the flux stack is left with a remainder and keeps
    // its slot. The vault pays the rest of the copper and frees nothing, so
    // the output lands in the one freed slot and the pack ends level.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(
      sim,
      14,
      [
        { itemId: 'copper_ore', count: 1 },
        { itemId: 'smithing_flux', count: 10 },
      ],
      pid,
    );
    seedVault(sim, { copper_ore: 3 }, pid);
    expect(meta.inventory.length).toBe(16);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);

    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
    expect(Object.hasOwn(vaultOf(sim, pid), 'copper_ore')).toBe(false); // all 3 drawn
    expect(sim.countItem('smithing_flux', pid)).toBe(1); // the surviving slot
    expect(meta.inventory.length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Batch (Create All).
// ---------------------------------------------------------------------------
describe('batch crafting counts the vault', () => {
  it('promises carried crafts PLUS vault crafts', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'spider_leg', 1, pid); // 1 craft from the bags
    seedVault(sim, { spider_leg: 2 }, pid); // 2 more from the vault

    expect(maxCraftCountForRecipe(sim.ctx, recipeById(JERKY)!, pid)).toBe(3);
    expect(metaOf(sim, pid).vaultWireRev).toBe(0); // scratch planning never marks the live wire
  });

  it('excludes identity-bearing vault rows from Create All and automatic consumption', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    meta.vault.special.push({
      itemId: 'spider_leg',
      count: 5,
      instance: { signer: 'Ada' },
    });
    const before = structuredClone(meta.vault.special);
    const recipe = recipeById(JERKY);
    if (!recipe) throw new Error(`missing recipe ${JERKY}`);

    expect(maxCraftCountForRecipe(sim.ctx, recipe, pid)).toBe(0);
    expect(resolveCraft(sim.ctx, pid, JERKY)).toMatchObject({
      ok: false,
      reason: 'insufficient_materials',
    });
    expect(meta.vault.special).toEqual(before);
  });

  it('promises only the carried crafts inside a blocked context', () => {
    // Same holdings, different place: the vault is invisible, so the promise
    // drops to what the bags alone can pay.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'spider_leg', 1, pid);
    seedVault(sim, { spider_leg: 2 }, pid);
    placeInDungeon(sim, pid);

    expect(maxCraftCountForRecipe(sim.ctx, recipeById(JERKY)!, pid)).toBe(1);
  });

  it('promises MATERIALS, not bag space: a vault-only batch stops at the pack', () => {
    // THE RECORDED RULING. A batch promise counts what the two pools can PAY
    // for; capacity is re-checked at every completion (the pre-existing craft
    // family shape, unchanged by the vault). Vault-only reagents make the two
    // diverge as far as they can go: the materials are ample and free NO bag
    // space, so the pack is the binding constraint and the chain stops on it.
    //
    // The vest is armor, so it never stacks: each copy needs its own slot,
    // which is what lets a SECOND craft fail where the first fit.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(sim, 15, [], pid); // exactly one free slot
    seedVault(sim, { copper_ore: 8, smithing_flux: 18 }, pid); // two crafts worth

    expect(maxCraftCountForRecipe(sim.ctx, recipeById(VEST)!, pid)).toBe(2);
    sim.craftItem(VEST, false, pid, 2);
    sim.drainEvents(); // discard the cast-start noise

    const { result: results, draws } = countDraws(sim, () => completeOneCraft(sim, pid));

    // One completion succeeded; the follow-on cast was refused on capacity.
    expect(results).toEqual([
      { ok: true, reason: undefined },
      { ok: false, reason: 'no_bag_space' },
    ]);
    expect(draws).toBe(1); // the successful craft's one proc roll; the refusal drew none
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
    expect(meta.inventory.length).toBe(16);
    // EXACTLY one craft's materials left the vault: the refused follow-on
    // consumed nothing from either pool.
    expect(fingerprint(vaultOf(sim, pid))).toBe('copper_ore=4,smithing_flux=9');
    expect(entityOf(sim, pid).craftCastRecipeId).toBe(''); // the chain stopped

    // And a fresh attempt from the same standing state is refused the same
    // way, spending nothing: the denial is a property of the pack, not a
    // one-off of the batch bookkeeping.
    const vaultBefore = fingerprint(vaultOf(sim, pid));
    const invBefore = JSON.stringify(meta.inventory);
    const retry = countDraws(sim, () => sim.craftItem(VEST, false, pid, 1));
    expect(metaOf(sim, pid).lastCraftResult?.reason).toBe('no_bag_space');
    expect(retry.draws).toBe(0);
    expect(fingerprint(vaultOf(sim, pid))).toBe(vaultBefore);
    expect(JSON.stringify(meta.inventory)).toBe(invBefore);
  });

  it('runs a promised batch to completion through the cast chain', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    setBags(sim, 0, [{ itemId: 'spider_leg', count: 1 }], pid);
    seedVault(sim, { spider_leg: 2 }, pid);
    const promised = maxCraftCountForRecipe(sim.ctx, recipeById(JERKY)!, pid);
    expect(promised).toBe(3);

    const completed = runCraftBatch(sim, JERKY, promised, pid);

    expect(completed).toBe(3);
    expect(sim.countItem('tough_jerky', pid)).toBe(3);
    expect(sim.countItem('spider_leg', pid)).toBe(0);
    expect(Object.hasOwn(vaultOf(sim, pid), 'spider_leg')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE GATE, END TO END.
// ---------------------------------------------------------------------------
describe('inside a dungeon the vault is invisible', () => {
  it('crafts from the bags exactly as outside, leaving the vault untouched', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 4, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);
    placeInDungeon(sim, pid);
    const before = fingerprint(vaultOf(sim, pid));

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, VEST));

    expect(result.ok).toBe(true);
    expect(draws).toBe(1); // the one masterwork proc draw, unchanged
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    expect(result.vaultDraws).toBeUndefined();
  });

  it('refuses a vault-payable craft, then the SAME player succeeds in the open world', () => {
    // The end-to-end pair: identical holdings, only the place changes.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'copper_ore', 1, pid);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);
    placeInDungeon(sim, pid);
    const before = fingerprint(vaultOf(sim, pid));

    const denied = countDraws(sim, () => resolveCraft(sim.ctx, pid, VEST));
    expect(denied.result.ok).toBe(false);
    expect(denied.result.reason).toBe('insufficient_materials');
    expect(denied.draws).toBe(0);
    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    expect(sim.countItem('copper_ore', pid)).toBe(1); // nothing consumed anywhere

    placeInOpenWorld(sim, pid);

    expect(resolveCraft(sim.ctx, pid, VEST).ok).toBe(true);
    expect(sim.countItem('eastbrook_chain_vest', pid)).toBe(1);
    expect(vaultOf(sim, pid).copper_ore).toBe(7); // the 3 the bags could not cover
  });
});

describe('inside a battleground the vault is invisible', () => {
  it('refuses a vault-payable craft, then the SAME player succeeds once released', () => {
    // The membership-keyed context, which refuses even in the frames where the
    // body has not been teleported into the band yet.
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { spider_leg: 3 }, pid);
    placeInBattleground(sim, pid);
    const before = fingerprint(vaultOf(sim, pid));

    const denied = countDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY));
    expect(denied.result.ok).toBe(false);
    expect(denied.result.reason).toBe('insufficient_materials');
    expect(denied.draws).toBe(0);
    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    expect(fingerprint(vaultOf(sim, pid))).toBe('spider_leg=3');

    // Off the field through the real exit (the roster entry goes and the body
    // is sent home), and the same stock pays.
    leaveBattleground(sim, pid);
    placeInOpenWorld(sim, pid);

    expect(resolveCraft(sim.ctx, pid, JERKY).ok).toBe(true);
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
    expect(vaultOf(sim, pid).spider_leg).toBe(2);
  });
});

describe('a mid-cast gate flip is enforced where the body stands at COMPLETION', () => {
  it('a vault-backed cast armed in the open world denies after a mid-cast teleport into the instance plane', () => {
    // The half-finished-teleport shape the geometry backstop exists for: the
    // admission approved a vault-backed plan in the open world, then the body
    // lands east of DUNGEON_X_THRESHOLD before the cast completes. The
    // completion re-runs the admission where the body stands, so the vault is
    // invisible again: deny, draw nothing, spend nothing.
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { spider_leg: 3 }, pid);
    placeInOpenWorld(sim, pid);
    sim.craftItem(JERKY, false, pid);
    expect(entityOf(sim, pid).craftCastRecipeId).toBe(JERKY); // armed: the vault paid the admission
    const before = fingerprint(vaultOf(sim, pid));

    entityOf(sim, pid).pos.x = DUNGEON_X_THRESHOLD + 1;
    const { result: results, draws } = countDraws(sim, () => completeOneCraft(sim, pid));

    expect(results).toEqual([{ ok: false, reason: 'insufficient_materials' }]);
    expect(draws).toBe(0); // the denial precedes every output-side draw
    expect(sim.countItem('tough_jerky', pid)).toBe(0);
    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
  });

  it('a carried-only cast armed inside a dungeon completes in the open world spending carried alone', () => {
    // The inverse flip: admitted carried-only inside the gate, completed
    // where the vault IS visible. Carried-first still holds at the new
    // location, so the bags pay and the vault stays byte-identical.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'spider_leg', 1, pid);
    seedVault(sim, { spider_leg: 3 }, pid);
    placeInDungeon(sim, pid);
    sim.craftItem(JERKY, false, pid);
    expect(entityOf(sim, pid).craftCastRecipeId).toBe(JERKY);
    const before = fingerprint(vaultOf(sim, pid));

    placeInOpenWorld(sim, pid);
    const results = completeOneCraft(sim, pid);

    expect(results).toEqual([{ ok: true, reason: undefined }]);
    expect(sim.countItem('tough_jerky', pid)).toBe(1);
    expect(sim.countItem('spider_leg', pid)).toBe(0); // the bags paid
    expect(fingerprint(vaultOf(sim, pid))).toBe(before); // the vault did not
  });
});

// ---------------------------------------------------------------------------
// Determinism: vault sourcing must not move a single rng draw.
// ---------------------------------------------------------------------------
describe('determinism: sourcing never changes the rng draw stream', () => {
  it('draws the same ONE roll and reports the same outcome from either pool', () => {
    const carried = makeSim(1234);
    grant(carried, 'spider_leg', 1, carried.playerId);
    const fromBags = recordDraws(carried, () => resolveCraft(carried.ctx, carried.playerId, JERKY));

    const vaulted = makeSim(1234);
    seedVault(vaulted, { spider_leg: 1 }, vaulted.playerId);
    const fromVault = recordDraws(vaulted, () =>
      resolveCraft(vaulted.ctx, vaulted.playerId, JERKY),
    );

    // The VALUE SEQUENCE, not just the count: two streams can draw the same
    // number of times and still have consumed the generator differently, and
    // an equal-length pair of different values is exactly what a sourcing
    // change that moved a draw would produce.
    expect(fromBags.values).toHaveLength(1); // the single masterwork proc roll
    expect(fromVault.values).toEqual(fromBags.values);
    // Every outcome field matches except the vault ledger itself.
    const { vaultDraws: bagsLedger, ...bagsOutcome } = fromBags.result;
    const { vaultDraws: vaultLedger, ...vaultOutcome } = fromVault.result;
    expect(vaultOutcome).toEqual(bagsOutcome);
    expect(bagsLedger).toBeUndefined(); // a bags-only craft carries no new field
    expect(vaultLedger).toEqual([{ itemId: 'spider_leg', count: 1 }]);
  });

  it('is reproducible: one seed, two runs, the same vault-sourced outcome', () => {
    // Same-seed determinism on the VAULT path itself, not just parity with
    // the carried path: the sim's first law is that a seed reproduces a world,
    // and a draw taken from a Map iteration or an object-key order would show
    // up here as a diverging second run while the cross-source case above
    // stayed green.
    const run = () => {
      const sim = makeSim(20_260_807);
      const pid = sim.playerId;
      seedVault(sim, { spider_leg: 1 }, pid);
      const { result, values } = recordDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY));
      return { result, values, vault: fingerprint(vaultOf(sim, pid)) };
    };

    const first = run();
    const second = run();

    expect(first.result.ok).toBe(true); // premise: a real craft, not a denial
    expect(second).toEqual(first);
    expect(first.values).toHaveLength(1);
    expect(first.vault).toBe(''); // the row was drawn to zero and deleted
  });

  it('a Jack-attuned crafter still draws exactly 2 when the vault pays', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    metaOf(sim, pid).archetype.isJackOfAllTrades = true;
    seedVault(sim, { spider_leg: 1 }, pid);

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY));

    expect(result.ok).toBe(true);
    expect(draws).toBe(2); // the variance roll plus the masterwork proc roll
  });

  it('a denial inside a blocked context draws nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    seedVault(sim, { spider_leg: 5 }, pid);
    placeInDungeon(sim, pid);

    const { result, draws } = countDraws(sim, () => resolveCraft(sim.ctx, pid, JERKY));

    expect(result.ok).toBe(false);
    expect(draws).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The #1145 self-signed discount derives from the BAGS only.
// ---------------------------------------------------------------------------
describe('self-signed discount with vault sourcing', () => {
  it('applies the discount from a signed BAG copy and draws the rest from the vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    sim.addItemInstance('copper_ore', { signer: meta.name }, pid, 1);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);

    const result = resolveCraft(sim.ctx, pid, VEST);

    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(true);
    // 4 listed, discounted to 3: the signed copy pays 1 and the vault pays 2.
    // Without the discount the vault would be at 7, so this literal is what
    // pins the discount composing with vault sourcing.
    expect(vaultOf(sim, pid).copper_ore).toBe(8);
    expect(sim.countItem('copper_ore', pid)).toBe(0);
  });

  it('never derives the discount from vault stock', () => {
    // Vault stock is bare counts with no instance payloads, so nothing in it
    // can carry a signer. The negative arm of the case above: same holdings,
    // signed copy absent, and the full four are required.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);

    const result = resolveCraft(sim.ctx, pid, VEST);

    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBeFalsy();
    expect(vaultOf(sim, pid).copper_ore).toBe(6);
  });

  it('keeps hold-not-spend: the kept signed copy survives and the vault is untouched', () => {
    // The discount is keyed on HOLDING a signed copy, not on spending one, and
    // the base grade drains first. So a player who keeps one signed FINE copy
    // back earns the -1 while spending plain ore (the established
    // material_grade_substitution.test.ts shape). Adding a full vault behind it
    // must not change that: the plain stack alone covers the discounted
    // requirement, so neither the signed copy nor the vault is touched.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    grant(sim, 'copper_ore', 3, pid);
    sim.addItemInstance('fine_copper_ore', { signer: meta.name }, pid, 1);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);

    const result = resolveCraft(sim.ctx, pid, VEST);

    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(true); // 3 required, not the listed 4
    expect(sim.countItem('copper_ore', pid)).toBe(0); // the plain stack paid all 3
    expect(sim.countItem('fine_copper_ore', pid)).toBe(1); // the kept copy survives
    expect(fingerprint(vaultOf(sim, pid))).toBe('copper_ore=10'); // vault never reached
  });

  it('carried-first still spends a signed copy before the vault once the plain stack is gone', () => {
    // The deliberate consequence of carried-first, pinned so nobody "fixes" it
    // by reaching into the vault ahead of the bags. With no plain ore left the
    // carried tier walks on to the fine grade and spends the signed copy, then
    // the vault covers the remainder. This is exactly what a bags-only craft
    // did before the vault existed, which is the point: adding a vault never
    // changes what the bags pay.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    sim.addItemInstance('fine_copper_ore', { signer: meta.name }, pid, 1);
    grant(sim, 'smithing_flux', 9, pid);
    seedVault(sim, { copper_ore: 10 }, pid);

    const result = resolveCraft(sim.ctx, pid, VEST);

    expect(result.ok).toBe(true);
    expect(result.selfSignedBonusApplied).toBe(true); // 3 required
    expect(sim.countItem('fine_copper_ore', pid)).toBe(0); // the signed copy went first
    expect(vaultOf(sim, pid).copper_ore).toBe(8); // then the vault paid the other 2
  });
});

// ---------------------------------------------------------------------------
// Enchanting: the same two-pool rule, grade-BLIND.
// ---------------------------------------------------------------------------
describe('apply-enchant draws carried-then-vault, grade-blind', () => {
  it('splits a bagged-plain enchant across the bags and the vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, SWORD, 1, pid);
    grant(sim, 'arcane_dust', 2, pid);
    seedVault(sim, { arcane_dust: 10 }, pid);

    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);

    expect(result.ok).toBe(true);
    // 5 dust: the 2 carried go first, the vault pays the other 3.
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
    expect(vaultOf(sim, pid).arcane_dust).toBe(7);
    expect(metaOf(sim, pid).vaultWireRev).toBe(1);
    // The victim is untouched apart from carrying the enchant payload.
    const enchanted = metaOf(sim, pid).inventory.find(
      (slot) => slot.itemId === SWORD && slot.instance?.enchant,
    );
    expect(enchanted?.instance?.enchant).toBe(ENCHANT);
    expect(enchanted?.count).toBe(1);
  });

  it('emits the vaultCraftConsume ledger event for what left the vault', () => {
    // THE PERMANENT AUDIT RECORD. A vault draw resolves inside sim.tick(),
    // several ticks after its command dispatch, so the server has no
    // before/after bracket to diff and observes this event instead. Without
    // this pin the emission could be deleted and every other enchant
    // assertion here would stay green while the bank_ledger silently lost
    // every enchant-side draw. Mirrors the craft-path pair in
    // professions_craft_cast_online.test.ts.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, SWORD, 1, pid);
    grant(sim, 'arcane_dust', 2, pid);
    seedVault(sim, { arcane_dust: 10 }, pid);
    // A non-default rung, so the ledger's purchased_slots_after value is
    // pinned to something a hardcoded 0 could not satisfy.
    metaOf(sim, pid).vault.upgrades = 3;
    sim.drainEvents(); // discard setup noise

    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT).ok).toBe(true);

    const consumes = sim.drainEvents().filter((ev) => ev.type === 'vaultCraftConsume');
    expect(consumes).toEqual([
      {
        type: 'vaultCraftConsume',
        pid,
        takes: [{ itemId: 'arcane_dust', count: 3 }], // only the 3 the VAULT paid
        upgrades: 3,
      },
    ]);
  });

  it('emits NO vaultCraftConsume for a bags-only enchant', () => {
    // The negative arm: a stocked vault that was never drawn from must leave
    // no ledger row, or the audit gains phantom consumption.
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, SWORD, 1, pid);
    grant(sim, 'arcane_dust', 5, pid); // the bags cover it whole
    seedVault(sim, { arcane_dust: 10 }, pid);
    metaOf(sim, pid).vault.upgrades = 3;
    sim.drainEvents();

    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT).ok).toBe(true);

    expect(sim.drainEvents().filter((ev) => ev.type === 'vaultCraftConsume')).toEqual([]);
    expect(vaultOf(sim, pid).arcane_dust).toBe(10);
  });

  it('enchants a WORN piece paying entirely from the vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, SWORD, 1, pid);
    sim.equipItemToSlot(SWORD, 'mainhand', pid);
    seedVault(sim, { arcane_dust: 5 }, pid);

    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT, 'mainhand');

    expect(result.ok).toBe(true);
    expect(metaOf(sim, pid).equipmentInstance.mainhand?.enchant).toBe(ENCHANT);
    expect(Object.hasOwn(vaultOf(sim, pid), 'arcane_dust')).toBe(false); // drawn to zero
  });

  it('refuses inside a dungeon when only the vault holds the reagents', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grant(sim, SWORD, 1, pid);
    seedVault(sim, { arcane_dust: 20 }, pid);
    placeInDungeon(sim, pid);
    const before = fingerprint(vaultOf(sim, pid));

    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    // The victim survives an enchant refusal untouched.
    expect(sim.countItem(SWORD, pid)).toBe(1);
  });

  it('reports the vault ledger only when units really moved', () => {
    // vaultDraws is present ONLY when at least one unit came out of the vault,
    // so a bags-only enchant returns the byte-identical object it always did,
    // and the ledger never covers the VICTIM copy.
    const vaulted = makeSim();
    grant(vaulted, SWORD, 1);
    grant(vaulted, 'arcane_dust', 2);
    seedVault(vaulted, { arcane_dust: 10 });
    const drew = resolveApplyEnchant(vaulted.ctx, vaulted.playerId, SWORD, ENCHANT);
    expect(drew.ok).toBe(true);
    expect(drew.vaultDraws).toEqual([{ itemId: 'arcane_dust', count: 3 }]);

    const bagsOnly = makeSim();
    grant(bagsOnly, SWORD, 1);
    grant(bagsOnly, 'arcane_dust', 5);
    seedVault(bagsOnly, { arcane_dust: 10 });
    const paid = resolveApplyEnchant(bagsOnly.ctx, bagsOnly.playerId, SWORD, ENCHANT);
    expect(paid.ok).toBe(true);
    expect(paid.vaultDraws).toBeUndefined();
    expect(vaultOf(bagsOnly).arcane_dust).toBe(10); // the bags covered it whole
  });
});

// ---------------------------------------------------------------------------
// The quest hook on a vault-only draw: the consumption comments in
// professions/crafting.ts and professions/enchanting.ts, pinned behaviorally.
// A vault-only draw must leave a collect objective on the reagent UNCHANGED
// (the hook's recompute reads ctx.countItem, which walks CARRIED inventory
// only) while still firing the hook for its wireRev bump (the dirty flag that
// makes hosts re-send the derived state whose inputs just moved). Each vault
// is seeded ABOVE the requirement so stock survives the draw: a recompute
// that started counting vault stock would find plenty at the post-draw fire,
// credit the objective, and fail the unchanged pin.
// ---------------------------------------------------------------------------
describe('a vault-only draw and the quest hook', () => {
  const COLLECT_QUEST = '__vault_only_collect';

  /** The bank.test.ts synthetic-collect idiom: register a throwaway quest
   *  over the reagent, run, always deregister. */
  function withCollectQuest(sim: Sim, itemId: string, run: () => void): void {
    QUESTS[COLLECT_QUEST] = {
      ...QUESTS.q_widows,
      id: COLLECT_QUEST,
      objectives: [{ type: 'collect', itemId, count: 5, label: 'Reagent' }],
    };
    try {
      metaOf(sim).questLog.set(COLLECT_QUEST, {
        questId: COLLECT_QUEST,
        counts: [0],
        state: 'active',
      });
      run();
    } finally {
      delete QUESTS[COLLECT_QUEST];
    }
  }

  function progressEvents(sim: Sim) {
    return sim
      .drainEvents()
      .filter((ev) => ev.type === 'questProgress' && ev.questId === COLLECT_QUEST);
  }

  it('crafting: the collect objective stays untouched while wireRev bumps', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = metaOf(sim, pid);
    seedVault(sim, { spider_leg: 20 }, pid); // 1 needed, 19 survive the draw
    withCollectQuest(sim, 'spider_leg', () => {
      sim.drainEvents();
      const revBefore = m.wireRev;
      // Premise: the draw is VAULT-ONLY (zero carried copies to satisfy it).
      expect(sim.countItem('spider_leg', pid)).toBe(0);

      expect(resolveCraft(sim.ctx, pid, JERKY).ok).toBe(true);

      // The vault paid for the craft, exactly the one-unit draw (20 -> 19).
      expect(m.vault.stock.spider_leg).toBe(19);
      // Unchanged: carried spider_leg is 0 before and after, and the 19
      // units still in the vault must not credit the objective.
      expect(m.questLog.get(COLLECT_QUEST)).toMatchObject({ counts: [0], state: 'active' });
      expect(progressEvents(sim)).toEqual([]);
      // Exactly TWO bumps, one per hook fire: the reagent-consumption fire
      // (the vault-only arm under pin) plus the output grant's own
      // ctx.addItem fire. The exact count is the decisive form here:
      // dropping the vault-only fire still leaves the output fire, so a
      // bare greater-than would survive that regression.
      expect(m.wireRev).toBe(revBefore + 2);
      // Positive control: the synthetic wiring CAN credit, so the unchanged
      // pin above is not vacuous (a dead quest would also read unchanged).
      grant(sim, 'spider_leg', 1, pid);
      expect(m.questLog.get(COLLECT_QUEST)).toMatchObject({ counts: [1] });
    });
  });

  it('enchanting: the collect objective stays untouched while wireRev bumps', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const m = metaOf(sim, pid);
    grant(sim, SWORD, 1, pid);
    sim.equipItemToSlot(SWORD, 'mainhand', pid);
    seedVault(sim, { arcane_dust: 12 }, pid); // 5 needed, 7 survive the draw
    withCollectQuest(sim, 'arcane_dust', () => {
      sim.drainEvents();
      const revBefore = m.wireRev;
      // Premise: the draw is VAULT-ONLY (zero carried copies to satisfy it).
      expect(sim.countItem('arcane_dust', pid)).toBe(0);

      expect(resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT, 'mainhand').ok).toBe(true);

      // The vault paid for the enchant, exactly the five-unit draw (12 -> 7).
      expect(m.vault.stock.arcane_dust).toBe(7);
      expect(m.questLog.get(COLLECT_QUEST)).toMatchObject({ counts: [0], state: 'active' });
      expect(progressEvents(sim)).toEqual([]);
      // Exactly ONE bump: the worn arm mutates no bag slot (reagents leave
      // the vault, the payload lands on the worn copy), so the vault-draw
      // ledger fire in applyEnchantReagentDraw is the only hook fire on this
      // path. Dropping it leaves wireRev at revBefore, which is exactly the
      // regression this pin exists to catch.
      expect(m.wireRev).toBe(revBefore + 1);
      grant(sim, 'arcane_dust', 1, pid);
      expect(m.questLog.get(COLLECT_QUEST)).toMatchObject({ counts: [1] });
    });
  });
});

// The apply-enchant start gate is a hand-copied transcription of the
// resolver's deny arms (the professions_admission_drift.test.ts contract), and
// the vault added a new way for the two to disagree: a cast that starts on
// materials the resolve cannot source, or is refused at start for materials
// the resolve would have found in the vault. Every row drives BOTH halves and
// pins them to the SAME literal.
describe('apply-enchant admission agrees with its resolver about the vault', () => {
  type Arm = {
    name: string;
    slot: 'mainhand' | undefined;
    confirmReplace: boolean | undefined;
    setup: (sim: Sim, pid: number) => void;
    /** The WHOLE setup for the full-pack case (it replaces the inventory, so
     *  it cannot be layered on top of `setup`): the victim in place and the
     *  pack filled to capacity. Vault-sourced dust frees nothing, so each
     *  arm's answer is decided by what its own victim frees. */
    packedSetup: (sim: Sim, pid: number) => void;
    packedDenies: boolean;
  };

  // The three resolve arms, each set up so ONLY the vault can pay the 5 dust.
  const ARMS: Arm[] = [
    {
      name: 'the worn arm',
      slot: 'mainhand',
      confirmReplace: undefined,
      setup: (sim, pid) => {
        grant(sim, SWORD, 1, pid);
        sim.equipItemToSlot(SWORD, 'mainhand', pid);
      },
      // The piece never leaves the equipment slot and no copy is minted into
      // the bags, so this arm has no capacity gate to fail: a full pack is
      // irrelevant to it. Pinned so a future capacity check bolted onto the
      // worn arm cannot start refusing enchants that need no bag room.
      packedSetup: (sim, pid) => {
        grant(sim, SWORD, 1, pid);
        sim.equipItemToSlot(SWORD, 'mainhand', pid);
        setBags(sim, 16, [], pid);
      },
      packedDenies: false,
    },
    {
      name: 'the bagged-plain arm',
      slot: undefined,
      confirmReplace: undefined,
      setup: (sim, pid) => grant(sim, SWORD, 1, pid),
      // The victim comes from a legacy multi-copy slot, so consuming one copy
      // frees NOTHING and the minted instance needs a slot of its own. The
      // vault dust cannot pay for that slot, so this arm denies.
      packedSetup: (sim, pid) => {
        setBags(sim, 15, [{ itemId: SWORD, count: 2 }], pid);
      },
      packedDenies: true,
    },
    {
      name: 'the bagged replace arm',
      slot: undefined,
      confirmReplace: true,
      setup: (sim, pid) => {
        sim.addItemInstance(SWORD, { enchant: REPLACED_ENCHANT }, pid, 1);
      },
      // NEAR NET NEUTRAL, and that is the point: the enchanted victim is a
      // one-per-slot instance, so consuming it frees exactly the slot the
      // replacement lands in. A full pack still succeeds, and that success is
      // NOT an over-credit of room.
      packedSetup: (sim, pid) => {
        setBags(sim, 15, [], pid);
        sim.addItemInstance(SWORD, { enchant: REPLACED_ENCHANT }, pid, 1);
      },
      packedDenies: false,
    },
  ];

  for (const arm of ARMS) {
    it(`admits and resolves ${arm.name} on vault-only reagents`, () => {
      const sim = makeSim();
      const pid = sim.playerId;
      arm.setup(sim, pid);
      seedVault(sim, { arcane_dust: 5 }, pid);

      const admission = evaluateApplyEnchantAdmission(
        sim.ctx,
        pid,
        SWORD,
        ENCHANT,
        arm.slot,
        arm.confirmReplace,
      );
      expect(admission, 'admission should admit').toBeNull();

      const resolved = resolveApplyEnchant(
        sim.ctx,
        pid,
        SWORD,
        ENCHANT,
        arm.slot,
        arm.confirmReplace,
      );
      expect(resolved.ok, `resolver denied: ${JSON.stringify(resolved)}`).toBe(true);
      expect(Object.hasOwn(vaultOf(sim, pid), 'arcane_dust')).toBe(false); // all 5 drawn
    });

    it(`refuses ${arm.name} on BOTH halves inside a dungeon`, () => {
      const sim = makeSim();
      const pid = sim.playerId;
      arm.setup(sim, pid);
      seedVault(sim, { arcane_dust: 20 }, pid);
      placeInDungeon(sim, pid);
      const before = fingerprint(vaultOf(sim, pid));

      const admission = evaluateApplyEnchantAdmission(
        sim.ctx,
        pid,
        SWORD,
        ENCHANT,
        arm.slot,
        arm.confirmReplace,
      );
      const resolved = resolveApplyEnchant(
        sim.ctx,
        pid,
        SWORD,
        ENCHANT,
        arm.slot,
        arm.confirmReplace,
      );

      expect(admission?.ok).toBe(false);
      expect(admission?.reason).toBe('insufficient_materials');
      expect(resolved.ok).toBe(false);
      expect(resolved.reason).toBe('insufficient_materials');
      expect(fingerprint(vaultOf(sim, pid))).toBe(before);
    });

    it(`agrees on capacity for ${arm.name} at a full pack, vault-only dust`, () => {
      // The capacity half of the same drift contract, per arm and on BOTH
      // halves. A vault-sourced unit never occupied a bag slot, so the ONLY
      // room any of these arms gets is what its own victim frees: the worn
      // piece frees nothing but needs nothing, the multi-copy plain victim
      // frees nothing and needs a slot, and the replace victim frees exactly
      // the slot its replacement lands in.
      const sim = makeSim();
      const pid = sim.playerId;
      arm.packedSetup(sim, pid);
      seedVault(sim, { arcane_dust: 5 }, pid);
      const meta = metaOf(sim, pid);
      expect(meta.inventory.length).toBe(16); // premise: the pack really is full
      const vaultBefore = fingerprint(vaultOf(sim, pid));

      const admission = evaluateApplyEnchantAdmission(
        sim.ctx,
        pid,
        SWORD,
        ENCHANT,
        arm.slot,
        arm.confirmReplace,
      );
      const resolved = resolveApplyEnchant(
        sim.ctx,
        pid,
        SWORD,
        ENCHANT,
        arm.slot,
        arm.confirmReplace,
      );

      if (arm.packedDenies) {
        expect(admission?.reason, 'admission').toBe('no_bag_space');
        expect(resolved.reason, 'resolver').toBe('no_bag_space');
        // A refusal spends nothing, in either pool.
        expect(fingerprint(vaultOf(sim, pid))).toBe(vaultBefore);
        expect(meta.inventory.length).toBe(16);
      } else {
        expect(admission, 'admission should admit').toBeNull();
        expect(resolved.ok, `resolver denied: ${JSON.stringify(resolved)}`).toBe(true);
        // The dust came out of the vault, and the pack never grew.
        expect(Object.hasOwn(vaultOf(sim, pid), 'arcane_dust')).toBe(false);
        expect(meta.inventory.length).toBe(16);
      }
    });
  }
});

describe('apply-enchant capacity: vault-sourced reagents free NO room', () => {
  // The victim comes from a legacy multi-copy slot, so consuming one copy
  // frees nothing and the minted instance needs a slot of its own. The ONLY
  // thing that can free that slot is a fully consumed CARRIED reagent stack,
  // which makes this a clean A/B on where the dust lives.
  it('CONTROL: succeeds when the carried dust stack frees the slot', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(
      sim,
      14,
      [
        { itemId: SWORD, count: 2 },
        { itemId: 'arcane_dust', count: 5 },
      ],
      pid,
    );
    expect(meta.inventory.length).toBe(16);

    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);

    expect(result.ok).toBe(true);
    expect(meta.inventory.length).toBe(16);
  });

  it('REFUSES the same enchant when the dust comes from the vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = setBags(sim, 15, [{ itemId: SWORD, count: 2 }], pid);
    seedVault(sim, { arcane_dust: 5 }, pid);
    expect(meta.inventory.length).toBe(16);

    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, ENCHANT);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_bag_space');
    expect(vaultOf(sim, pid).arcane_dust).toBe(5); // nothing spent
    expect(sim.countItem(SWORD, pid)).toBe(2); // the victim survives
    expect(meta.inventory.length).toBe(16);
  });
});

// PR #3670 hot-path finding: the craft gate's geometry fast path must decide
// BEFORE the two pool scans (instanceInfoAt walks every instance slot;
// riftInstanceAtPos walks the rift pool), so the common open-world evaluation
// (probed EVERY snapshot per connected player as the cvault wire signature's
// gate half) costs three membership
// probes plus one comparison. The round-4 hoist extends the same economy to
// the east side: the geometry backstop now answers AHEAD of the scans, so a
// session standing inside an instance refuses at one comparison instead of
// walking the slot pool every broadcast. Hand-rolled trap ctx: the pool
// properties THROW on access, so a regression that re-runs a scan on either
// side fails loudly rather than silently re-paying the walk.
describe('vaultDrawBlocked: the geometry fast path precedes the pool scans', () => {
  const trapCtx = (pos: { x: number; y: number; z: number }): any => ({
    resolve: () => ({ meta: {}, e: { pos } }),
    bgMatches: new Map(),
    arenaMatches: new Map(),
    delveRunForPlayer: () => null,
    get instances(): never {
      throw new Error('instance pool scanned for a west-side position');
    },
    get riftInstances(): never {
      throw new Error('rift pool scanned for a west-side position');
    },
  });

  it('never touches the instance or rift pools west of the threshold (boundary inclusive)', () => {
    expect(vaultDrawBlocked(trapCtx({ x: 0, y: 0, z: 0 }), 1)).toBe(false);
    expect(vaultDrawBlocked(trapCtx({ x: DUNGEON_X_THRESHOLD, y: 0, z: 0 }), 1)).toBe(false);
  });

  it('the hoisted backstop answers the east side without touching the pools (round 4)', () => {
    // Before the round-4 hoist this was the trap's positive CONTROL: an
    // east-side position walked the instance pool, so the trap fired. The
    // hoist moves the geometry backstop AHEAD of the two scans (east of the
    // threshold every scan outcome already ended in true, so the order is
    // behavior-identical), and an east-side position now refuses at one
    // comparison with the pools untouched: a regression that moves the
    // backstop back below the scans THROWS the trap here instead of
    // returning. The trap mechanism keeps its positive control in the
    // DERIVED case below, which still forces a real pool consultation (and a
    // throw) by registering a west-capable def.
    expect(vaultDrawBlocked(trapCtx({ x: DUNGEON_X_THRESHOLD + 1, y: 0, z: 0 }), 1)).toBe(true);
    expect(vaultDrawBlocked(trapCtx({ x: 200_000, y: 0, z: 0 }), 1)).toBe(true);
  });

  it('DERIVED: registering a west-capable dungeon def re-enables the west-side pool scan', () => {
    // The fast path re-derives from the live defs on EVERY evaluation, so a
    // def whose claim footprint can cross the threshold disables it by
    // existing: the same trap position that never touched the pools above now
    // consults them. This is the adaptive half of the layout-independence pin
    // in tests/vault_craft_gate.test.ts (which proves the scan then REFUSES a
    // claimed west slot through the real Sim).
    const QA_ID = '__craft_gate_qa_west_dungeon';
    (DUNGEONS as Record<string, (typeof DUNGEONS)[string]>)[QA_ID] = {
      ...DUNGEONS.hollow_crypt,
      id: QA_ID,
      index: -100,
      spawns: [],
    };
    try {
      expect(() => vaultDrawBlocked(trapCtx({ x: 0, y: 0, z: 0 }), 1)).toThrow(
        /instance pool scanned/,
      );
    } finally {
      delete (DUNGEONS as Record<string, (typeof DUNGEONS)[string]>)[QA_ID];
    }
    // With the def gone, the per-call derivation clears: the fast path is back.
    expect(vaultDrawBlocked(trapCtx({ x: 0, y: 0, z: 0 }), 1)).toBe(false);
  });

  it('the rift pool stays untouched on BOTH sides of the threshold (round 4 hoist)', () => {
    // PR #3670 round 2 proved the rift arm ran inside the band by trapping
    // riftInstances behind a REAL empty dungeon pool. The round-4 hoist
    // retires that reachability ON PURPOSE: east of the threshold the
    // backstop answers before any scan, and west of it the isRiftPos band
    // guard is false while the band sits east, so with the shipped constants
    // no input reaches riftInstanceAtPos at all. The arm stays for the
    // layout move that would make it load-bearing again (a rift band west of
    // the threshold disables the fast path by existing); its keepers are the
    // one-occurrence source pin and the band-alignment pins in
    // tests/vault_craft_gate.test.ts. What this trap pins now: no rift-pool
    // walk on ANY side of the threshold in the shipped layout, the in-band
    // east case included.
    const riftTrap = (x: number): any => ({
      resolve: () => ({ meta: {}, e: { pos: { x, y: 0, z: 0 } } }),
      bgMatches: new Map(),
      arenaMatches: new Map(),
      delveRunForPlayer: () => null,
      instances: [],
      get riftInstances(): never {
        throw new Error('rift pool scanned');
      },
    });
    // Positive control for the trap MECHANISM itself: the getter really
    // throws when touched (the code path that would touch it is unreachable
    // by design now, so the direct read is the only honest control left).
    expect(() => riftTrap(0).riftInstances).toThrow(/rift pool scanned/);
    expect(vaultDrawBlocked(riftTrap(RIFT_X_MIN), 1)).toBe(true); // the backstop, not the scan
    expect(vaultDrawBlocked(riftTrap(DUNGEON_X_THRESHOLD + 1), 1)).toBe(true);
    expect(vaultDrawBlocked(riftTrap(0), 1)).toBe(false);
  });

  it('the membership arms still run BEFORE the fast path: a west-side bg member refuses', () => {
    // A formed-but-not-teleported match is exactly the frame the membership
    // arms exist for; an implementation that hoisted the geometry admit above
    // them would answer false here.
    const bg = trapCtx({ x: 0, y: 0, z: 0 });
    bg.bgMatches = new Map([[1, {}]]);
    expect(vaultDrawBlocked(bg, 1)).toBe(true);
    const arena = trapCtx({ x: 0, y: 0, z: 0 });
    arena.arenaMatches = new Map([[1, {}]]);
    expect(vaultDrawBlocked(arena, 1)).toBe(true);
    const delve = trapCtx({ x: 0, y: 0, z: 0 });
    delve.delveRunForPlayer = () => ({});
    expect(vaultDrawBlocked(delve, 1)).toBe(true);
  });
});

// PR #3670 round 2: claimWestReach (the fast path's west-reach envelope) is
// built from the exported claim-shape symbols in instances/dungeons.ts, and
// this case keeps the derivation honest against the REAL claim read: for
// every registered def, nothing even one yard WEST of the edge claimWestReach
// predicts may sit inside the claim, or the fast-path derivation would
// under-estimate a west-capable def and fail the gate OPEN. Probes run
// through instanceInfoAt (the exact read vaultDrawBlocked consumes), never a
// re-derived formula, over a pool holding ONLY the probed claim so no
// neighboring slot can answer for it.
describe('claimWestReach covers the true west reach of every registered claim', () => {
  it('no def claim reaches west of its predicted edge (1-yard quantum)', () => {
    const sim = makeSim();
    const pool = sim.ctx.instances;
    const template = pool[0];
    const realSlots = pool.splice(0, pool.length);
    try {
      for (const def of Object.values(DUNGEONS)) {
        const origin = instanceOrigin(def.index, 0);
        const reach = claimWestReach(def);
        pool.push({
          ...template,
          dungeonId: def.id,
          slot: 0,
          partyKey: 'solo:qa_west_reach',
          exitId: 998,
          clearedBy: new Set<number>(),
          enteredBy: new Set<number>(),
        });
        // Liveness controls, so the null assertions below cannot pass
        // vacuously: the rig detects THIS claim at its origin and just inside
        // the generic envelope's west edge (every def carries at least the
        // generic arm).
        expect(instanceInfoAt(sim.ctx, { x: origin.x, y: 0, z: origin.z })?.dungeonId).toBe(def.id);
        expect(
          instanceInfoAt(sim.ctx, {
            x: origin.x - INSTANCE_FOOTPRINT_HALF_WIDTH + 1,
            y: 0,
            z: origin.z,
          })?.dungeonId,
        ).toBe(def.id);
        // The decisive bound: one yard west of the predicted edge, swept
        // across the whole z extent a claim can occupy (both claim shapes are
        // clipped to |dz| < 250 around the slot origin), nothing is inside.
        const westX = origin.x - reach - 1;
        for (let dz = -255; dz <= 255; dz++) {
          const hit = instanceInfoAt(sim.ctx, { x: westX, y: 0, z: origin.z + dz });
          if (hit !== null) {
            expect.fail(`${def.id}: claim reaches x ${westX} (reach ${reach}) at dz ${dz}`);
          }
        }
        pool.pop();
      }
    } finally {
      pool.length = 0;
      pool.push(...realSlots);
    }
  });
});
