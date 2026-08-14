// Masterwrought phase 09, slice 3: the party-usable mobile crafting station
// (the Master's Field Forge item path). Pins the partyShared discriminator on
// MobileCraftingStation, the item placement path (placeMobileStationFromItem:
// no specialization gate, never consumed, zero rng, dead-gated, one success
// log line), the widened crafting station gate (a party member's ACTIVE
// partyShared station satisfies a type-matched recipe WITHIN STATION_RADIUS
// of the crafter; owner-only legacy stations never do), and the SET resolver
// activeMobileStationCraftsForViewer: the deduped, sorted array of every
// craft whose station serves the viewer (own at any distance, plus every
// in-range partyShared party station), so the crafting-window row set
// mirrors the craft gate exactly instead of shadowing one craft behind
// another. The owner-only arms themselves stay pinned by
// tests/professions_crafting_hub.test.ts; this file owns only the party half.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATION_RADIUS, STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { resolveCraft } from '../src/sim/professions/crafting';
import {
  placeMobileStationForPlayer,
  placeMobileStationFromItem,
} from '../src/sim/professions/mobile_station';
import {
  inRangeStationTypes,
  isAtStation,
  stationTypeForCraft,
} from '../src/sim/professions/stations';
import { isSpecialized } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';
import type { ItemDef, SimEvent, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Entity-stripped world (the tests/social_shared.ts SOCIAL_TEST_WORLD shape,
// redefined locally per the tests/CLAUDE.md sim-test convention): every case
// here talks only between hand-added players, so ambient camps/NPCs/objects
// just cost construction time.
const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeWorld(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD });
}

function simCtx(sim: Sim) {
  return (sim as any).ctx;
}

function metaOf(sim: Sim, pid: number) {
  return (sim as any).players.get(pid);
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = (sim as any).entities.get(pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

function drainEvents(sim: Sim): SimEvent[] {
  return (sim as any).drainEvents();
}

// A real trainer-taught forge recipe (weaponcrafting rung 0). The premise is
// re-derived from the live table rather than assumed, so a content change
// that unbinds it from the forge fails HERE, not as a silent green.
const FORGE_RECIPE_ID = 'recipe_copper_bearded_axe';
function mustForgeRecipe() {
  const recipe = ALL_RECIPES.find((r) => r.id === FORGE_RECIPE_ID);
  if (!recipe) throw new Error(`${FORGE_RECIPE_ID} missing from ALL_RECIPES`);
  if (recipe.stationType !== 'forge') {
    throw new Error(`${FORGE_RECIPE_ID} is no longer forge-bound`);
  }
  return recipe;
}

/** Teach the recipe and grant exactly the recipe's own reagent list. */
function readyForgeCrafter(sim: Sim, pid: number) {
  const recipe = mustForgeRecipe();
  metaOf(sim, pid).knownRecipes.add(recipe.id);
  for (const reagent of recipe.reagents) grantItem(sim, reagent.itemId, reagent.count, pid);
  return recipe;
}

function makeParty(sim: Sim, ...pids: number[]) {
  const [leader, ...rest] = pids;
  for (const pid of rest) {
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
  }
}

// A spot far outside every static station circle, so any station-gate pass in
// these tests is attributable to the mobile arms alone (asserted per test via
// isAtStation, not assumed from the coordinate).
const FIELD = { x: 5000, z: 5000 };

// Synthetic use-item carrying the new placeMobileStation ItemUse arm,
// injected into the live ITEMS table (the equip_drop_core.test.ts precedent).
// A test-owned id, deliberately NOT the shipped Master's Field Forge def:
// this file pins the PLUMBING, the content row is another suite's surface.
const TEST_FORGE_ID = 'test_field_forge_plumbing';
const TEST_FORGE_NAME = 'Test Field Forge';

beforeAll(() => {
  ITEMS[TEST_FORGE_ID] = {
    id: TEST_FORGE_ID,
    name: TEST_FORGE_NAME,
    kind: 'tool',
    use: { type: 'placeMobileStation', stationCraftId: 'weaponcrafting' },
    sellValue: 1,
  } as ItemDef;
});

afterAll(() => {
  delete ITEMS[TEST_FORGE_ID];
});

describe("Master's Field Forge item placement (placeMobileStation ItemUse)", () => {
  it('useItem places a partyShared forge-craft station with NO specialization gate', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const m = metaOf(sim, a);
    // The live specialization gate really would refuse this player: the item
    // path bypassing it is a behavior difference, not a dead gate.
    expect(isSpecialized(m.craftSkills, 'weaponcrafting')).toBe(false);
    expect(placeMobileStationForPlayer(simCtx(sim), 'weaponcrafting', a)).toBeUndefined();
    expect(m.mobileStation).toBeNull();

    teleport(sim, a, FIELD.x, FIELD.z);
    grantItem(sim, TEST_FORGE_ID, 1, a);
    drainEvents(sim);
    sim.useItem(TEST_FORGE_ID, a);

    const station = m.mobileStation;
    expect(station).not.toBeNull();
    expect(station.partyShared).toBe(true);
    expect(station.craftId).toBe('weaponcrafting');
    // The craft identity resolves to the forge through the live mapping.
    expect(stationTypeForCraft(station.craftId)).toBe('forge');
    expect(station.pos).toEqual({ x: FIELD.x, z: FIELD.z });
    // A permanent tool: the use never consumes the item.
    expect(sim.countItem(TEST_FORGE_ID, a)).toBe(1);
    // Success is never silent: the one scroll-pattern log line, exactly once
    // (matched by log.placeStation in src/ui/sim_i18n.ts).
    const placeLines = drainEvents(sim).filter(
      (ev) => ev.type === 'log' && ev.text === `You set up ${TEST_FORGE_NAME}.`,
    );
    expect(placeLines.length).toBe(1);
  });

  it('the line carries no article of its own (a "The ..." item never doubles it)', () => {
    // The Laden Hearth is the shipped name that made the omission visible:
    // gluing "the" on produced "You set up the The Laden Hearth." The emit
    // follows the quaff/read pattern instead and lets the name carry its own
    // article, in English and in every {item} template downstream.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, FIELD.x, FIELD.z);
    drainEvents(sim);
    placeMobileStationFromItem(simCtx(sim), 'cooking', ITEMS.laden_hearth.name, a);

    const lines = drainEvents(sim)
      .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log')
      .map((ev) => ev.text)
      .filter((text) => text.includes('set up'));
    expect(lines).toEqual(['You set up The Laden Hearth.']);
  });

  it('placement draws zero rng', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, FIELD.x, FIELD.z);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    const station = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, a);
    (sim as any).rng.setObserver(null);
    expect(station).toBeDefined();
    expect(draws).toBe(0);
  });

  it('is deterministic: the same seed and commands place and craft identically twice', () => {
    const run = () => {
      const sim = makeWorld(7);
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('priest', 'Bet');
      makeParty(sim, a, b);
      for (let i = 0; i < 10; i++) sim.tick();
      teleport(sim, b, FIELD.x, FIELD.z);
      const station = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b);
      teleport(sim, a, FIELD.x + 10, FIELD.z);
      readyForgeCrafter(sim, a);
      const result = resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID);
      return { station, ok: result.ok, mst: sim.activeMobileStationCraftsFor(a) };
    };
    const first = run();
    // The anchor is the live tick at placement, not a wall clock: 10 ticks in
    // on both runs, so both records agree without ever reading Date.now.
    expect(first.station?.placedAtTick).toBe(10);
    expect(first.ok).toBe(true);
    expect(first.mst).toEqual(['weaponcrafting']);
    expect(run()).toEqual(first);
  });

  it('the item path is dead-gated: exactly one while-dead refusal, slot untouched', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, FIELD.x, FIELD.z);
    grantItem(sim, TEST_FORGE_ID, 1, a);
    const e = (sim as any).entities.get(a);
    e.hp = 0;
    e.dead = true;
    drainEvents(sim);
    sim.useItem(TEST_FORGE_ID, a);
    const events = drainEvents(sim);
    const deadErrors = events.filter(
      (ev) => ev.type === 'error' && ev.text === "You can't do that while dead.",
    );
    expect(deadErrors.length).toBe(1);
    // No placement, no success line, and the permanent tool survives.
    expect(metaOf(sim, a).mobileStation).toBeNull();
    expect(events.some((ev) => ev.type === 'log')).toBe(false);
    expect(sim.countItem(TEST_FORGE_ID, a)).toBe(1);
  });

  it('item and specialization placements clobber each other: the slot holds the newer record', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, FIELD.x, FIELD.z);
    metaOf(sim, a).craftSkills.cooking = 75;
    const legacy = placeMobileStationForPlayer(simCtx(sim), 'cooking', a);
    expect(legacy).toBeDefined();
    expect(metaOf(sim, a).mobileStation).toBe(legacy);

    // The item placement OVERWRITES the active specialization station...
    const shared = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, a);
    expect(shared).toBeDefined();
    expect(metaOf(sim, a).mobileStation).toBe(shared);
    expect(metaOf(sim, a).mobileStation.partyShared).toBe(true);
    // ...and the old grant is GONE with it: the set carries only the newer craft.
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['weaponcrafting']);

    // The reverse clobber: a new specialization placement replaces the shared
    // one, and the shared grant is gone.
    const legacyAgain = placeMobileStationForPlayer(simCtx(sim), 'cooking', a);
    expect(legacyAgain).toBeDefined();
    expect(metaOf(sim, a).mobileStation).toBe(legacyAgain);
    expect(metaOf(sim, a).mobileStation.partyShared).toBe(false);
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['cooking']);
  });
});

describe('crafting station gate: the partyShared arm', () => {
  it('a party member crafts a forge recipe within STATION_RADIUS of the shared forge', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();

    teleport(sim, a, FIELD.x + STATION_RADIUS - 2, FIELD.z);
    const recipe = readyForgeCrafter(sim, a);
    // The pass below is attributable to the party arm alone: no static forge
    // in reach, and the crafter has no station of their own.
    const crafterPos = (sim as any).entities.get(a).pos;
    expect(isAtStation(STATIONS, crafterPos, 'forge')).toBe(false);
    expect(metaOf(sim, a).mobileStation).toBeNull();

    const result = resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID);
    expect(result.ok).toBe(true);
    expect(sim.countItem(recipe.resultItemId, a)).toBe(1);
  });

  it('crafts at exactly STATION_RADIUS from the shared station, refused one unit past', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();

    // ON the boundary: the gate is <=, so exactly STATION_RADIUS away crafts.
    teleport(sim, a, FIELD.x + STATION_RADIUS, FIELD.z);
    const recipe = readyForgeCrafter(sim, a);
    expect(resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID).ok).toBe(true);

    // One unit past: denied, consuming nothing.
    teleport(sim, a, FIELD.x + STATION_RADIUS + 1, FIELD.z);
    readyForgeCrafter(sim, a);
    const denied = resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('station_required');
    for (const reagent of recipe.reagents) {
      expect(sim.countItem(reagent.itemId, a)).toBe(reagent.count);
    }
  });

  it('a NON-party player standing beside the shared forge is refused', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    makeParty(sim, a, b); // c stays outside the party
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();

    teleport(sim, c, FIELD.x + 1, FIELD.z);
    readyForgeCrafter(sim, c);
    const result = resolveCraft(simCtx(sim), c, FORGE_RECIPE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('station_required');
  });

  it('a shared station of a FOREIGN-type craft never satisfies a forge recipe', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    // alchemy maps to the apothecary, verified against the live mapping so a
    // content remap fails HERE, not as a silent green elsewhere.
    expect(stationTypeForCraft('alchemy')).toBe('apothecary');
    expect(placeMobileStationFromItem(simCtx(sim), 'alchemy', 'Test Field Still', b)).toBeDefined();

    teleport(sim, a, FIELD.x + 1, FIELD.z);
    readyForgeCrafter(sim, a);
    const result = resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('station_required');
    // The crafts SET still carries the craft under its own identity: the set
    // carries crafts, and the type mapping happens in inRangeStationTypes.
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['alchemy']);
    const types = inRangeStationTypes(STATIONS, (sim as any).entities.get(a).pos, ['alchemy']);
    expect(types.has('apothecary')).toBe(true);
    expect(types.has('forge')).toBe(false);
  });

  it('regression: a legacy specialization placement stays owner-only for party members', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    metaOf(sim, b).craftSkills.weaponcrafting = 75; // specialized: placement is gated on it
    const station = placeMobileStationForPlayer(simCtx(sim), 'weaponcrafting', b);
    expect(station).toBeDefined();
    // The discriminator, not an absent field: specialization placements set
    // owner-only explicitly.
    expect(station?.partyShared).toBe(false);

    // Right beside the owner, same party, type-matched recipe: still refused.
    teleport(sim, a, FIELD.x + 1, FIELD.z);
    readyForgeCrafter(sim, a);
    expect(resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID).reason).toBe('station_required');

    // The OWNER's own gate is untouched by the widening: b still crafts.
    readyForgeCrafter(sim, b);
    expect(resolveCraft(simCtx(sim), b, FORGE_RECIPE_ID).ok).toBe(true);
  });

  it('expiry ends the party grant', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    const station = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b);
    expect(station).toBeDefined();
    if (!station) return;

    teleport(sim, a, FIELD.x + 5, FIELD.z);
    readyForgeCrafter(sim, a);
    expect(resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID).ok).toBe(true);

    // Shorten the window to the next tick and cross it with a REAL tick, so
    // the expiry is exercised in the tick domain rather than rewritten into
    // the past (isStationActive is a strict < on expiresAtTick).
    station.expiresAtTick = sim.tickCount + 1;
    sim.tick();
    readyForgeCrafter(sim, a);
    expect(resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID).reason).toBe('station_required');
    expect(sim.activeMobileStationCraftsFor(a)).toEqual([]);
  });
});

describe('activeMobileStationCraftsFor set arms', () => {
  it('own only is a one-craft set; a DIFFERENT-craft in-range shared station joins it, sorted', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, a, FIELD.x, FIELD.z);
    metaOf(sim, a).craftSkills.cooking = 75;
    expect(placeMobileStationForPlayer(simCtx(sim), 'cooking', a)).toBeDefined();
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['cooking']);

    // The arm that kills the old single-id shadowing: the shared craft joins
    // the own craft instead of being hidden behind it, sorted order.
    teleport(sim, b, FIELD.x + 2, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['cooking', 'weaponcrafting']);
  });

  it('an own craft equal to an in-range shared craft dedupes to one entry', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, a, FIELD.x, FIELD.z);
    teleport(sim, b, FIELD.x + 2, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();
    metaOf(sim, a).craftSkills.weaponcrafting = 75;
    expect(placeMobileStationForPlayer(simCtx(sim), 'weaponcrafting', a)).toBeDefined();
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['weaponcrafting']);
  });

  it('every in-range shared station contributes: no nearest pick, no tie-break', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    makeParty(sim, a, b, c);
    // Two shared stations 18 units apart with distinct craft ids: under the
    // retired nearest rule only one could surface; the set carries both.
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();
    teleport(sim, c, FIELD.x + 18, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'armorcrafting', 'Test Field Anvil', c),
    ).toBeDefined();

    teleport(sim, a, FIELD.x + 4, FIELD.z); // 4 from b's, 14 from c's: both in range
    expect(sim.activeMobileStationCraftsFor(a)).toEqual(['armorcrafting', 'weaponcrafting']);
  });

  it('in range AT the boundary, absent beyond it, and never a legacy station', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(
      placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', TEST_FORGE_NAME, b),
    ).toBeDefined();

    // The gate is <=: exactly STATION_RADIUS away is still in the set.
    teleport(sim, a, FIELD.x + STATION_RADIUS, FIELD.z);
    const atBoundary = sim.activeMobileStationCraftsFor(a);
    expect(atBoundary).toEqual(['weaponcrafting']);
    // The non-empty array is FROZEN like the ClientWorld mirror's split
    // result (tests/snapshots.test.ts pins the online half), so both IWorld
    // implementations hand consumers one array contract: a mutation throws
    // in either world instead of succeeding offline only.
    expect(Object.isFrozen(atBoundary)).toBe(true);
    teleport(sim, a, FIELD.x + STATION_RADIUS + 1, FIELD.z);
    // The empty case allocates nothing: the frozen module constant, returned
    // by identity on every empty resolve.
    const empty = sim.activeMobileStationCraftsFor(a);
    expect(empty).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(sim.activeMobileStationCraftsFor(a)).toBe(empty);

    // A legacy owner-only station never joins a party member's set, however
    // close: replace b's shared station with a specialization placement.
    metaOf(sim, b).craftSkills.weaponcrafting = 75;
    expect(placeMobileStationForPlayer(simCtx(sim), 'weaponcrafting', b)).toBeDefined();
    teleport(sim, a, FIELD.x + 1, FIELD.z);
    expect(sim.activeMobileStationCraftsFor(a)).toEqual([]);
  });
});
