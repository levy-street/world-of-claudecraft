import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Recipe pattern items (Masterwrought phase 02): a kind:'recipe' drop that
// teaches ONE ProfessionRecipeRecord when used from the bags and is spent doing
// so. The learn path is src/sim/professions/pattern_items.ts (a pure resolver
// plus a thin apply function), dispatched from the `recipe` arm of items.ts
// useItem. Everything here drives the REAL path (sim.useItem / the server's
// 'use' wire command), never the module's internals by hand, so the arms that
// only exist because of where the dispatch sits (below useItem's dead gate)
// are actually covered.
//
// The fixtures are synthetic on purpose: recipes pushed onto the live
// ALL_RECIPES array (recipeById linear-scans it) plus item defs injected
// into the live ITEMS table, all removed in afterAll, so no shipped-id golden
// sees them and no content has to exist yet for this behavior to be pinned.

import { stackSizeOf } from '../src/sim/bags';
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { isItemLocked } from '../src/sim/item_lock';
import {
  defaultMarketQuery,
  MARKET_ITEM_TYPE_FILTERS,
  marketItemMatches,
} from '../src/sim/market_query';
import { resolvePatternLearn } from '../src/sim/professions/pattern_items';
import type { TrainResult } from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { Sim } from '../src/sim/sim';
import type { Entity, RecipeItemDef, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { supportedLanguages } from '../src/ui/i18n';
import { DICT } from '../src/ui/sim_i18n';

// Mock the db layer so the online arm below needs no Postgres (shape from
// tests/prof_intro_hint_online.test.ts). Hoisted above the server/game import.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { bareClient, broadcast, fakeWs, joinServer } from './helpers/bare_client';

// The three refusal literals, spelled out once. These ARE the registered
// English matcher rows (pinned against DICT.en at the bottom of this file), and
// the S3 guard ties those rows to the emit site in pattern_items.ts, so the
// chain from test literal to matcher to emit closes with no self-comparison
// link anywhere in it.
const KNOWN_ERROR = 'You already know that recipe.';
const PROFESSION_ERROR = 'You have not practiced that profession.';
const TIER_ERROR = 'Your skill is too low to learn that pattern.';

const CRAFT = 'weaponcrafting';

// skillReq 100 lands the recipe on tier 4 (tierForSkill buckets by 25), so a
// player at 99 sits one tier short and a player at 100 is exactly at tier: the
// boundary both arms of the tier case below straddle.
const PATTERN_RECIPE: ProfessionRecipeRecord = {
  id: 'recipe_test_pattern_taught',
  professionId: CRAFT,
  resultItemId: 'eastbrook_arming_sword',
  resultCount: 1,
  reagents: [{ itemId: 'bone_fragments', count: 1 }],
  skillReq: 100,
  itemLevelBudget: 1,
  level: 1,
  acquisition: ['drop'],
};

// Trainer-only: a pattern pointing at it is an authoring bug, and the content
// guard must swallow it silently rather than blame the player's character.
const TRAINER_ONLY_RECIPE: ProfessionRecipeRecord = {
  id: 'recipe_test_pattern_trainer_only',
  professionId: CRAFT,
  resultItemId: 'eastbrook_arming_sword',
  resultCount: 1,
  reagents: [{ itemId: 'bone_fragments', count: 1 }],
  skillReq: 0,
  itemLevelBudget: 1,
  level: 1,
  acquisition: ['trainer'],
};

// The grandfathered shape: NO acquisition list at all, the form the launch-era
// recipes actually ship in. isRecipeKnown answers true for EVERYONE on such a
// recipe, so a pattern naming one exercises two things nothing else can: the
// resolver's optional chain over a missing list, and the invalid-before-
// already_known ranking on the real path (swapped arms would blame the player
// with the known line instead of staying silent).
const GRANDFATHERED_RECIPE: ProfessionRecipeRecord = {
  id: 'recipe_test_pattern_grandfathered',
  professionId: CRAFT,
  resultItemId: 'eastbrook_arming_sword',
  resultCount: 1,
  reagents: [{ itemId: 'bone_fragments', count: 1 }],
  skillReq: 0,
  itemLevelBudget: 1,
  level: 1,
};

// Every item id this suite injects shares this prefix, which is what lets the
// shipped-content sweep at the bottom skip exactly this suite's defs: three of
// the four are DELIBERATELY malformed (they exist to drive the silent-guard
// arms), so a sweep that saw them would fail on fixtures rather than content.
const SYNTHETIC_ID_PREFIX = 'test_pattern_';
const PATTERN_ID = 'test_pattern_arming_sword';
const MISSING_PATTERN_ID = 'test_pattern_missing_recipe';
const TRAINER_PATTERN_ID = 'test_pattern_trainer_only';
const GRANDFATHERED_PATTERN_ID = 'test_pattern_grandfathered';
const MISSING_RECIPE_ID = 'recipe_test_pattern_no_such_recipe';

// No cast: the annotation makes tsc the guard for the very shape the kind
// exists to force (teachesRecipeId required, no use payload, no stackSize).
function patternDef(id: string, name: string, teachesRecipeId: string): RecipeItemDef {
  return { id, name, kind: 'recipe', teachesRecipeId, sellValue: 25 };
}

beforeAll(() => {
  ALL_RECIPES.push(PATTERN_RECIPE, TRAINER_ONLY_RECIPE, GRANDFATHERED_RECIPE);
  ITEMS[PATTERN_ID] = patternDef(PATTERN_ID, 'Pattern: Test Arming Sword', PATTERN_RECIPE.id);
  ITEMS[MISSING_PATTERN_ID] = patternDef(
    MISSING_PATTERN_ID,
    'Pattern: Test Missing Recipe',
    MISSING_RECIPE_ID,
  );
  ITEMS[TRAINER_PATTERN_ID] = patternDef(
    TRAINER_PATTERN_ID,
    'Pattern: Test Trainer Only',
    TRAINER_ONLY_RECIPE.id,
  );
  ITEMS[GRANDFATHERED_PATTERN_ID] = patternDef(
    GRANDFATHERED_PATTERN_ID,
    'Pattern: Test Grandfathered',
    GRANDFATHERED_RECIPE.id,
  );
});

afterAll(() => {
  for (const recipe of [PATTERN_RECIPE, TRAINER_ONLY_RECIPE, GRANDFATHERED_RECIPE]) {
    const at = ALL_RECIPES.indexOf(recipe);
    if (at >= 0) ALL_RECIPES.splice(at, 1);
  }
  for (const id of [PATTERN_ID, MISSING_PATTERN_ID, TRAINER_PATTERN_ID, GRANDFATHERED_PATTERN_ID]) {
    delete ITEMS[id];
  }
});

function makeWorld(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

/** A player with `skill` in the pattern's craft, holding `count` copies. */
function patternHolder(sim: Sim, skill: number, count = 1, itemId = PATTERN_ID) {
  const pid = sim.addPlayer('warrior', 'Patternist');
  const meta = sim.meta(pid);
  if (!meta) throw new Error('missing meta');
  meta.autoEquip = false;
  meta.craftSkills[CRAFT] = skill;
  if (count > 0) sim.addItem(itemId, count, pid);
  sim.drainEvents();
  return { pid, meta };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

function trainResults(events: SimEvent[]): Array<Extract<SimEvent, { type: 'trainResult' }>> {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'trainResult' }> => e.type === 'trainResult',
  );
}

/** Use `itemId` and return every event the use produced, exactly. */
function useAndCollect(sim: Sim, itemId: string, pid: number): SimEvent[] {
  sim.drainEvents();
  sim.useItem(itemId, pid);
  return sim.drainEvents();
}

/** Use `itemId` and return every error line the use produced, exactly. */
function useAndCollectErrors(sim: Sim, itemId: string, pid: number): string[] {
  return errorTexts(useAndCollect(sim, itemId, pid));
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(sim: Sim, pid: number): void {
  const m = merchant(sim);
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

describe('resolvePatternLearn (the pure resolver)', () => {
  // The deny ORDER is the contract, so each arm is checked with EVERY later
  // condition also failing: an arm that answered out of order would return a
  // different reason here, not merely a differently-worded one.
  it('answers invalid for an unresolved recipe and for one that is not a drop', () => {
    const sim = makeWorld();
    const { meta } = patternHolder(sim, 0, 0);
    expect(resolvePatternLearn(undefined, meta)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolvePatternLearn(TRAINER_ONLY_RECIPE, meta)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    // The grandfathered shape carries NO acquisition list at all: the optional
    // chain must answer invalid, never throw, and never fall through to the
    // already_known arm (which is true of everyone for this recipe).
    expect(resolvePatternLearn(GRANDFATHERED_RECIPE, meta)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('ranks already_known above profession, and profession above tier', () => {
    const sim = makeWorld();
    const { meta } = patternHolder(sim, 0, 0);
    // skill 0 fails BOTH the profession and the tier arm; profession wins.
    expect(resolvePatternLearn(PATTERN_RECIPE, meta)).toEqual({ ok: false, reason: 'profession' });
    meta.knownRecipes.add(PATTERN_RECIPE.id);
    // Now every one of the three later arms would fail; already_known wins.
    expect(resolvePatternLearn(PATTERN_RECIPE, meta)).toEqual({
      ok: false,
      reason: 'already_known',
    });
  });

  it('answers tier for a practiced-but-underskilled crafter and ok at tier', () => {
    const sim = makeWorld();
    const { meta } = patternHolder(sim, 99, 0);
    expect(resolvePatternLearn(PATTERN_RECIPE, meta)).toEqual({ ok: false, reason: 'tier' });
    meta.craftSkills[CRAFT] = 100;
    expect(resolvePatternLearn(PATTERN_RECIPE, meta)).toEqual({ ok: true });
  });
});

describe('using a recipe pattern (offline host, the real useItem path)', () => {
  it('learns the recipe, consumes the copy, and shows up on the public crafting read', () => {
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100);
    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(false);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
    // A SENTINEL, not the birth default (which is null): the pin below has to
    // tell "the learn left this alone" apart from "nothing has ever written
    // it", and only a pre-stamped value can. meta.lastTrainResult is the train
    // COMMAND's own probe, so a pattern learn writing it would leave the next
    // reader holding a train outcome that never happened.
    const probeSentinel: TrainResult = { ok: false, recipeId: 'recipe_sentinel', fee: 7 };
    meta.lastTrainResult = probeSentinel;

    const events = useAndCollect(sim, PATTERN_ID, pid);
    expect(errorTexts(events)).toEqual([]);
    // The success FEEDBACK, and the whole reason a learn is not silent: the
    // same text-free personal trainResult Sim.trainRecipe emits, which is what
    // makes the hud log "You have learned {recipe}." and flip the train
    // window's row to Known with no client change. Exactly one, so a second
    // emit site cannot creep in and double-log the learn.
    expect(trainResults(events)).toEqual([
      { type: 'trainResult', ok: true, recipeId: PATTERN_RECIPE.id, pid },
    ]);

    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(true);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(0);
    // Untouched, object identity included: Sim.trainRecipe assigns a fresh
    // resolveTrain result here on EVERY train, ok or not, and the pattern path
    // deliberately does not (see the comment at its emit site).
    expect(meta.lastTrainResult).toBe(probeSentinel);
    // The public read the offline HUD actually consumes, not the raw Set: this
    // is the surface a client sees, so the learn is proven end to end offline.
    expect(sim.craftingIdentityFor(pid).knownRecipes).toContain(PATTERN_RECIPE.id);
  });

  it('consumes exactly one copy, leaving the rest of the stack alone', () => {
    const sim = makeWorld();
    const { pid } = patternHolder(sim, 100, 2);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(2);

    expect(useAndCollectErrors(sim, PATTERN_ID, pid)).toEqual([]);

    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
  });

  it('spends the exact clicked copy when the use names a slot, sparing a locked sibling', () => {
    // The v0.38.0 item lock (issue 3042) made same-id copies distinguishable
    // per copy, which turned the learn's old newest-first consume into a
    // wrong-victim hazard: click the unlocked copy, lose the locked one. The
    // selection now rides the use exactly as the equip arms forward it.
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 2);
    const slots = meta.inventory
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.itemId === PATTERN_ID);
    // Patterns never stack, so the two copies occupy two distinct slots.
    expect(slots).toHaveLength(2);
    const [lower, higher] = slots;
    expect(lower.index).toBeLessThan(higher.index);
    // Lock the HIGHER-index copy, the one the legacy newest-first walk would
    // have destroyed; the player clicks the LOWER, unlocked copy.
    higher.slot.instance = { ...(higher.slot.instance ?? {}), locked: true };
    sim.drainEvents();
    sim.useItem(PATTERN_ID, pid, lower.index);
    const events = sim.drainEvents();
    expect(errorTexts(events)).toEqual([]);
    expect(trainResults(events)).toHaveLength(1);

    const survivors = meta.inventory.filter((slot) => slot.itemId === PATTERN_ID);
    expect(survivors).toHaveLength(1);
    expect(isItemLocked(survivors[0].instance)).toBe(true);
  });

  it('keeps the legacy newest-first walk for an id-only use, locked copies included', () => {
    // The frozen-fallback doctrine (src/sim/item_copy_ref.ts): the id-only
    // walk is deliberately never improved, because the parity goldens drive
    // use through it. That means an id-only use with a locked newest copy
    // still destroys THAT copy (use is outside the lock's refusal scope by
    // the release's own first-pass contract: salvage, craft consumption,
    // vendor sell only). Pinned so the surface stays a decision, not an
    // accident; a lock-aware fallback here would be a parity-visible change.
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 2);
    const slots = meta.inventory
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.itemId === PATTERN_ID);
    expect(slots).toHaveLength(2);
    const [lower, higher] = slots;
    higher.slot.instance = { ...(higher.slot.instance ?? {}), locked: true };
    sim.drainEvents();
    sim.useItem(PATTERN_ID, pid);
    const events = sim.drainEvents();
    expect(trainResults(events)).toHaveLength(1);

    const survivors = meta.inventory.filter((slot) => slot.itemId === PATTERN_ID);
    expect(survivors).toHaveLength(1);
    // The newest (locked) copy died; the older unlocked copy survives.
    expect(isItemLocked(survivors[0].instance)).toBe(false);
    expect(survivors[0]).toBe(lower.slot);
  });

  it('refuses a crafter who has never practiced the craft, keeping the pattern', () => {
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 0);

    const events = useAndCollect(sim, PATTERN_ID, pid);
    expect(errorTexts(events)).toEqual([PROFESSION_ERROR]);
    // A refusal is ctx.error-only. An ok:false trainResult would ALSO render
    // through the hud's trainResult deny arm, so the player would read the
    // same refusal twice in two different wordings.
    expect(trainResults(events)).toEqual([]);

    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(false);
    expect(sim.craftingIdentityFor(pid).knownRecipes).not.toContain(PATTERN_RECIPE.id);
  });

  it('refuses one tier short and learns at tier: both sides of the skill boundary', () => {
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 99);

    const denied = useAndCollect(sim, PATTERN_ID, pid);
    expect(errorTexts(denied)).toEqual([TIER_ERROR]);
    expect(trainResults(denied)).toEqual([]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(false);

    // One point of skill crosses from tier 3 to tier 4 and the same click lands.
    meta.craftSkills[CRAFT] = 100;
    expect(useAndCollectErrors(sim, PATTERN_ID, pid)).toEqual([]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(0);
    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(true);
  });

  it('refuses a second copy once the recipe is known, keeping that copy', () => {
    const sim = makeWorld();
    const { pid } = patternHolder(sim, 100, 2);

    expect(useAndCollectErrors(sim, PATTERN_ID, pid)).toEqual([]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);

    const denied = useAndCollect(sim, PATTERN_ID, pid);
    expect(errorTexts(denied)).toEqual([KNOWN_ERROR]);
    expect(trainResults(denied)).toEqual([]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
  });

  it('tells an already-taught crafter they know it even with zero skill in the craft', () => {
    // The deny-order pin on the REAL path: both the already-known and the
    // profession arm are live, and already-known must win. Get there by
    // learning for real, then dropping the skill back to zero.
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 2);
    expect(useAndCollectErrors(sim, PATTERN_ID, pid)).toEqual([]);
    meta.craftSkills[CRAFT] = 0;

    const denied = useAndCollect(sim, PATTERN_ID, pid);
    expect(errorTexts(denied)).toEqual([KNOWN_ERROR]);
    expect(trainResults(denied)).toEqual([]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
  });

  it('is silent for a pattern whose recipe id does not resolve, and never consumes it', () => {
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 1, MISSING_PATTERN_ID);

    sim.drainEvents();
    sim.useItem(MISSING_PATTERN_ID, pid);
    // No event of ANY type: an authoring bug reads as a dead click, exactly
    // like useItem's own unknown-def arm, never as a refusal line.
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.countItem(MISSING_PATTERN_ID, pid)).toBe(1);
    expect(meta.knownRecipes.size).toBe(0);
  });

  it('is silent for a pattern whose recipe is not acquirable by drop, and never consumes it', () => {
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 1, TRAINER_PATTERN_ID);

    sim.drainEvents();
    sim.useItem(TRAINER_PATTERN_ID, pid);
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.countItem(TRAINER_PATTERN_ID, pid)).toBe(1);
    expect(meta.knownRecipes.has(TRAINER_ONLY_RECIPE.id)).toBe(false);
  });

  it('is silent for a pattern whose recipe has no acquisition list at all, and never consumes it', () => {
    // The grandfathered shape (the launch-era recipes ship exactly this way).
    // isRecipeKnown answers TRUE for everyone here, so total silence is also
    // the invalid-before-already_known ranking pinned on the REAL path: with
    // the arms swapped this click would emit the known line and blame the
    // player for an authoring bug.
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 1, GRANDFATHERED_PATTERN_ID);

    sim.drainEvents();
    sim.useItem(GRANDFATHERED_PATTERN_ID, pid);
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.countItem(GRANDFATHERED_PATTERN_ID, pid)).toBe(1);
    expect(meta.knownRecipes.has(GRANDFATHERED_RECIPE.id)).toBe(false);
  });

  it('is a silent no-op while dead: the dispatch sits below useItem dead gate', () => {
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100);
    const p = sim.entities.get(pid);
    if (!p) throw new Error(`missing entity ${pid}`);
    p.dead = true;

    sim.drainEvents();
    sim.useItem(PATTERN_ID, pid);
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(1);
    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(false);
  });

  it('draws no rng at all on a successful learn', () => {
    const sim = makeWorld();
    const { pid } = patternHolder(sim, 100);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.useItem(PATTERN_ID, pid);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(0);
    // Positive control (the tests/mounts.test.ts idiom): the SAME wiring
    // really counts a draw, so the zero above is a measurement, not a dead
    // probe left green by a neutered observer.
    sim.rng.setObserver(() => draws++);
    try {
      sim.rng.next();
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(1);
  });

  it('draws no rng on any refusal arm either', () => {
    // Every deny arm under one observer: profession, tier, already_known, and
    // all three silent invalid shapes. The error lines asserted at the end are
    // what prove the refusal arms actually RAN under the observer (an arm that
    // silently did nothing would also draw nothing).
    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 0, 1);
    sim.addItem(MISSING_PATTERN_ID, 1, pid);
    sim.addItem(TRAINER_PATTERN_ID, 1, pid);
    sim.addItem(GRANDFATHERED_PATTERN_ID, 1, pid);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.useItem(PATTERN_ID, pid); // profession (skill 0)
      meta.craftSkills[CRAFT] = 99;
      sim.useItem(PATTERN_ID, pid); // tier (one short)
      meta.knownRecipes.add(PATTERN_RECIPE.id);
      meta.craftSkills[CRAFT] = 100;
      sim.useItem(PATTERN_ID, pid); // already_known
      sim.useItem(MISSING_PATTERN_ID, pid); // invalid: unresolvable id
      sim.useItem(TRAINER_PATTERN_ID, pid); // invalid: not drop-acquirable
      sim.useItem(GRANDFATHERED_PATTERN_ID, pid); // invalid: no list at all
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(errorTexts(sim.drainEvents())).toEqual([PROFESSION_ERROR, TIER_ERROR, KNOWN_ERROR]);
    // Nothing was consumed by any refusal.
    for (const id of [PATTERN_ID, MISSING_PATTERN_ID, TRAINER_PATTERN_ID, GRANDFATHERED_PATTERN_ID])
      expect(sim.countItem(id, pid), id).toBe(1);
    // Positive control through the identical wiring.
    sim.rng.setObserver(() => draws++);
    try {
      sim.rng.next();
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(1);
  });
});

describe('patterns never stack (one per bag slot, classic style)', () => {
  it('caps at one per slot, so two copies occupy two distinct inventory slots', () => {
    // 'recipe' is an UNSTACKED_KIND in src/sim/bags.ts, joining gear: classic
    // recipe drops are one per slot. That is what makes a hoard of unlearned
    // patterns cost real bag space, and it is the premise behind the bag chip
    // rationale in src/ui/bag_filter.ts.
    expect(stackSizeOf(ITEMS[PATTERN_ID])).toBe(1);

    const sim = makeWorld();
    const { pid, meta } = patternHolder(sim, 100, 2);
    const slots = meta.inventory.filter((s) => s.itemId === PATTERN_ID);
    expect(slots.length).toBe(2);
    expect(slots.map((s) => s.count)).toEqual([1, 1]);
    expect(sim.countItem(PATTERN_ID, pid)).toBe(2);

    // And the learn spends exactly one of the two slots, not one of a stack.
    expect(useAndCollectErrors(sim, PATTERN_ID, pid)).toEqual([]);
    expect(meta.inventory.filter((s) => s.itemId === PATTERN_ID).length).toBe(1);
  });
});

describe('patterns on the World Market', () => {
  it('browses under the other type filter, and no other bucket claims it', () => {
    // A pattern is not a weapon, armor, bag, consumable, material or cosmetic,
    // so the catch-all bucket is the honest home for it. Driving the whole
    // exported filter list means a future chip that started claiming patterns
    // fails here instead of quietly splitting them across two tabs.
    const matched = MARKET_ITEM_TYPE_FILTERS.filter((itemType) =>
      marketItemMatches(PATTERN_ID, { ...defaultMarketQuery(), itemType }),
    );
    // Sorted on BOTH sides: the claim is which chips match, not the order the
    // chip list happens to declare them in, and reordering MARKET_ITEM_TYPE_FILTERS
    // is a presentation change that must not red this pin.
    expect([...matched].sort()).toEqual(['all', 'other'].sort());
  });

  it('lists a pattern for sale: tradable drops, bound only by being consumed', () => {
    const sim = makeWorld();
    const { pid } = patternHolder(sim, 0);
    standAtMerchant(sim, pid);
    sim.drainEvents();

    sim.marketList(PATTERN_ID, 1, 500, pid);

    expect(errorTexts(sim.drainEvents())).toEqual([]);
    const listing = sim.marketListings.find(
      (l) => l.sellerKey === String(pid) && l.itemId === PATTERN_ID,
    );
    expect(listing?.count).toBe(1);
    // Fully escrowed: the seller keeps none, so the listing is real, not a
    // silently-dropped no-op that left the item in the bags.
    expect(sim.countItem(PATTERN_ID, pid)).toBe(0);
  });
});

describe('using a recipe pattern over the live server (online host)', () => {
  it('learns server-side and the learned id reaches the client through the cprof mirror', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 91, 'Patternist');
    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.autoEquip = false;
    meta.craftSkills[CRAFT] = 100;
    server.sim.addItem(PATTERN_ID, 1, session.pid);

    // Baseline mirror BEFORE the learn, through the real ClientWorld.
    broadcast(server);
    const client = bareClient(session.pid);
    const snaps = () => fc.sent.filter((m) => m.t === 'snap');
    const applyLatest = () => {
      const list = snaps();
      (client as unknown as { applySnapshot: (s: unknown) => void }).applySnapshot(
        list[list.length - 1],
      );
    };
    applyLatest();
    expect(client.craftingIdentity.synced).toBe(true);
    expect(client.craftingIdentity.knownRecipes).not.toContain(PATTERN_RECIPE.id);

    // The REAL wire command the bag click sends: no server change was needed
    // for patterns, so this is the existing 'use' route end to end.
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'use', item: PATTERN_ID }));

    expect(meta.knownRecipes.has(PATTERN_RECIPE.id)).toBe(true);
    expect(server.sim.countItem(PATTERN_ID, session.pid)).toBe(0);

    // The success FEEDBACK on the wire, not merely in the sim's queue.
    // routeEvents is the real per-session fan-out the world loop drives, and
    // broadcastSnapshots never touches the event queue, so without this the
    // cprof pin below would stay green for a learn whose "You have learned"
    // line reached nobody. Exactly one, addressed to this session's pid.
    (server as unknown as { routeEvents(events: SimEvent[]): void }).routeEvents(
      server.sim.drainEvents(),
    );
    const delivered = fc.sent
      .filter((m) => m.t === 'events')
      .flatMap((m) => m.list as SimEvent[])
      .filter((e) => e.type === 'trainResult');
    expect(delivered).toEqual([
      { type: 'trainResult', ok: true, recipeId: PATTERN_RECIPE.id, pid: session.pid },
    ]);

    broadcast(server);
    applyLatest();
    expect(client.craftingIdentity.knownRecipes).toContain(PATTERN_RECIPE.id);
  });
});

describe('shipped pattern content shape', () => {
  // VACUOUS TODAY on purpose: no shipped item carries kind 'recipe' yet, so
  // this sweep asserts over an empty set until phase 11 authors the drops. It
  // goes live the moment it does, and the two conditions it checks are exactly
  // the ones resolvePatternLearn refuses SILENTLY: a pattern that trips either
  // is a dead click with no message at all, the worst failure mode this
  // feature has, and content review is the only place to catch it.
  it('skips exactly this suite own synthetic ids, and they are really present', () => {
    // The skip below is only safe while it covers this file's fixtures and
    // nothing else. Three of the four are deliberately malformed; if a shipped
    // id ever took this prefix, the sweep would silently stop checking it.
    const synthetic = Object.keys(ITEMS)
      .filter((id) => id.startsWith(SYNTHETIC_ID_PREFIX))
      .sort();
    expect(synthetic).toEqual(
      [PATTERN_ID, MISSING_PATTERN_ID, TRAINER_PATTERN_ID, GRANDFATHERED_PATTERN_ID].sort(),
    );
  });

  it('every kind:recipe item teaches a resolvable, drop-acquirable recipe', () => {
    for (const [id, def] of Object.entries(ITEMS)) {
      if (def.kind !== 'recipe') continue;
      if (id.startsWith(SYNTHETIC_ID_PREFIX)) continue;
      const recipe = recipeById(def.teachesRecipeId);
      expect(
        recipe,
        `${id} teaches ${def.teachesRecipeId}, which resolves to no recipe`,
      ).toBeDefined();
      expect(
        recipe?.acquisition,
        `${id} teaches ${def.teachesRecipeId}, which no drop may teach`,
      ).toContain('drop');
    }
  });

  it('every kind:recipe item honors the tradable-drop contract its comments state', () => {
    // The def-level claims RecipeItemDef's doc rests on, none of which the
    // TYPE can enforce: quality 'poor' would let one Sell Junk click vendor
    // the pattern (junkSellableSlot gates on quality, not kind), and
    // soulbound / noMarketList would contradict bind-by-consumption. NO
    // synthetic-id skip, deliberately unlike the sweep above: this suite's
    // four fixtures all satisfy these three assertions, so sweeping them too
    // keeps the loop and its field reads provably live today instead of
    // vacuous until phase 11.
    for (const def of Object.values(ITEMS)) {
      if (def.kind !== 'recipe') continue;
      const id = def.id;
      expect(def.quality, `${id}: a poor-quality pattern is swept by Sell Junk`).not.toBe('poor');
      expect(def.soulbound ?? false, `${id}: soulbound contradicts bind-by-consumption`).toBe(
        false,
      );
      expect(def.noMarketList ?? false, `${id}: patterns are deliberately listable`).toBe(false);
    }
  });
});

describe('pattern refusal localization', () => {
  it('registers all three refusals as the exact English matcher rows', () => {
    expect(DICT.en['error.patternKnown']).toBe(KNOWN_ERROR);
    expect(DICT.en['error.patternProfession']).toBe(PROFESSION_ERROR);
    expect(DICT.en['error.patternSkill']).toBe(TIER_ERROR);
  });

  it('carries a real translation of all three in every non-English locale', () => {
    // The sim DICT scope is invisible to the release-fill worklist, and the
    // DICT assembly backfills a dropped row with English, so the S2 key-count
    // parity can never notice one going missing. Byte-identical English in a
    // non-en block is exactly that silent leak, and this is the guard for it.
    // en_CA deliberately inherits English.
    const locales = supportedLanguages.filter((lang) => lang !== 'en' && lang !== 'en_CA');
    expect(locales.length).toBeGreaterThanOrEqual(20);
    for (const lang of locales) {
      for (const key of [
        'error.patternKnown',
        'error.patternProfession',
        'error.patternSkill',
      ] as const) {
        const row = DICT[lang][key];
        expect(row && row.trim().length > 0, `${lang}.${key} empty or missing`).toBe(true);
        expect(row, `${lang}.${key} left as English`).not.toBe(DICT.en[key]);
      }
    }
  });
});
