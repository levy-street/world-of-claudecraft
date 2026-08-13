// Masterwrought phase 09, slice 3: the party-usable mobile crafting station
// (the Master's Field Forge item path). Pins the partyShared discriminator on
// MobileCraftingStation, the item placement path (placeMobileStationFromItem:
// no specialization gate, never consumed, zero rng), the widened crafting
// station gate (a party member's ACTIVE partyShared station satisfies a
// type-matched recipe WITHIN STATION_RADIUS of the crafter; owner-only legacy
// stations never do), and the widened activeMobileStationCraftFor resolver
// (own station first, else the nearest in-range partyShared party station).
// The owner-only arms themselves stay pinned by
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
import { isAtStation, stationTypeForCraft } from '../src/sim/professions/stations';
import { isSpecialized } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';
import type { ItemDef, WorldContent } from '../src/sim/types';
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

beforeAll(() => {
  ITEMS[TEST_FORGE_ID] = {
    id: TEST_FORGE_ID,
    name: 'Test Field Forge',
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
  });

  it('placement draws zero rng', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, FIELD.x, FIELD.z);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    const station = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', a);
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
      const station = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b);
      teleport(sim, a, FIELD.x + 10, FIELD.z);
      readyForgeCrafter(sim, a);
      const result = resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID);
      return { station, ok: result.ok, mst: sim.activeMobileStationCraftFor(a) };
    };
    const first = run();
    // The anchor is the live tick at placement, not a wall clock: 10 ticks in
    // on both runs, so both records agree without ever reading Date.now.
    expect(first.station?.placedAtTick).toBe(10);
    expect(first.ok).toBe(true);
    expect(run()).toEqual(first);
  });
});

describe('crafting station gate: the partyShared arm', () => {
  it('a party member crafts a forge recipe within STATION_RADIUS of the shared forge', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b)).toBeDefined();

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

  it('denies station_required OUTSIDE the radius, consuming nothing', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b)).toBeDefined();

    teleport(sim, a, FIELD.x + STATION_RADIUS + 5, FIELD.z);
    const recipe = readyForgeCrafter(sim, a);

    const result = resolveCraft(simCtx(sim), a, FORGE_RECIPE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('station_required');
    // No side effect on denial: every reagent count intact.
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
    expect(placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b)).toBeDefined();

    teleport(sim, c, FIELD.x + 1, FIELD.z);
    readyForgeCrafter(sim, c);
    const result = resolveCraft(simCtx(sim), c, FORGE_RECIPE_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('station_required');
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
    const station = placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b);
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
    expect(sim.activeMobileStationCraftFor(a)).toBeNull();
  });
});

describe('activeMobileStationCraftFor resolver arms', () => {
  it("the viewer's own active station beats an in-range party shared one", () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, a, FIELD.x, FIELD.z);
    teleport(sim, b, FIELD.x + 2, FIELD.z);
    expect(placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b)).toBeDefined();
    // The shared forge alone surfaces first...
    expect(sim.activeMobileStationCraftFor(a)).toBe('weaponcrafting');
    // ...then the viewer's OWN station takes the single mst id over it (the
    // accepted single-id asymmetry: both cannot surface at once).
    metaOf(sim, a).craftSkills.cooking = 75;
    expect(placeMobileStationForPlayer(simCtx(sim), 'cooking', a)).toBeDefined();
    expect(sim.activeMobileStationCraftFor(a)).toBe('cooking');
  });

  it('surfaces the NEAREST in-range shared station, by live viewer position', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    makeParty(sim, a, b, c);
    // Two shared stations 18 units apart, both forge-typed but with distinct
    // craft ids so the winner is observable through the single mst id.
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b)).toBeDefined();
    teleport(sim, c, FIELD.x + 18, FIELD.z);
    expect(placeMobileStationFromItem(simCtx(sim), 'armorcrafting', c)).toBeDefined();

    teleport(sim, a, FIELD.x + 4, FIELD.z); // 4 from b's, 14 from c's
    expect(sim.activeMobileStationCraftFor(a)).toBe('weaponcrafting');
    teleport(sim, a, FIELD.x + 15, FIELD.z); // 15 from b's, 3 from c's
    expect(sim.activeMobileStationCraftFor(a)).toBe('armorcrafting');
  });

  it('in range AT the boundary, out of range beyond it, and never a legacy station', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    makeParty(sim, a, b);
    teleport(sim, b, FIELD.x, FIELD.z);
    expect(placeMobileStationFromItem(simCtx(sim), 'weaponcrafting', b)).toBeDefined();

    // The gate is <=: exactly STATION_RADIUS away still surfaces.
    teleport(sim, a, FIELD.x + STATION_RADIUS, FIELD.z);
    expect(sim.activeMobileStationCraftFor(a)).toBe('weaponcrafting');
    teleport(sim, a, FIELD.x + STATION_RADIUS + 1, FIELD.z);
    expect(sim.activeMobileStationCraftFor(a)).toBeNull();

    // A legacy owner-only station never surfaces to a party member, however
    // close: replace b's shared station with a specialization placement.
    metaOf(sim, b).craftSkills.weaponcrafting = 75;
    expect(placeMobileStationForPlayer(simCtx(sim), 'weaponcrafting', b)).toBeDefined();
    teleport(sim, a, FIELD.x + 1, FIELD.z);
    expect(sim.activeMobileStationCraftFor(a)).toBeNull();
  });
});
