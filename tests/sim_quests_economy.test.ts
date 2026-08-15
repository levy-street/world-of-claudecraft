// Shard 2 of the core sim suite (food/drink/vendor, quests, RL interface).
// Shared fixtures live in tests/sim_shared.ts; the formulas/movement/combat
// shard is tests/sim.test.ts.
import { describe, expect, it } from 'vitest';
import { GROUND_PICKUP_LINES } from '../src/sim/content/ground_pickup_lines';
import {
  BUILTIN_WORLD,
  DEEPFEN_SHALLOWS_LAKE,
  GROUND_OBJECTS,
  ITEMS,
  LAKE,
  NPCS,
  QUESTS,
} from '../src/sim/data';
import { ACTIONS, applyAction, encodeObs, obsSize } from '../src/sim/obs';
import { completeFishing } from '../src/sim/professions/fishing';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  FISHING_CAST_ID,
  type SimEvent,
  type WorldContent,
  xpForLevel,
} from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import {
  despawnMobs,
  EMPTY_TEST_WORLD,
  facePlayerAt,
  makePickupSim,
  makeRlSim,
  makeScopedSim,
  nearestMob,
  teleportTo,
  VENDOR_TEST_WORLD,
} from './sim_shared';

const TEST_SWIM_DEPTH = 0.8;
const FISHING_TEST_DISTANCES = [4, 8, 12, 16, 20, 24];

// Only the 'quests' describe block below needs a world with BOTH the zone1
// forest_wolf camps (>=8 wolves for q_wolves) AND full npcs (marshal_redbrook
// gives/turns in q_wolves, q_bandits, q_greyjaw; trader_wilkes gives q_boars).
// No existing tests/sim_shared.ts fixture keeps both at once (WOLF_TEST_WORLD
// zeroes npcs, VENDOR_TEST_WORLD keeps only one wolf camp), so this stays a
// small bespoke local fixture rather than a shared one.
const QUESTS_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'forest_wolf'),
  groundObjects: [],
};

function hasFishableWaterAhead(x: number, z: number, facing: number, seed: number): boolean {
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  return FISHING_TEST_DISTANCES.some(
    (d) => terrainHeight(x + sin * d, z + cos * d, seed) < WATER_LEVEL - TEST_SWIM_DEPTH,
  );
}

// Everything reelable from the Eastbrook Vale (Mirror Lake) fishing table.
const VALE_CATCHES = ['raw_mirror_trout', 'raw_river_perch', 'tangled_weed', 'glimmerfin_koi'];
const valeCatchCount = (sim: Sim) => VALE_CATCHES.reduce((n, id) => n + sim.countItem(id), 0);

function mirrorLakeFishingSpot(seed: number) {
  for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8; r += 1) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = LAKE.x + Math.cos(a) * r;
      const z = LAKE.z + Math.sin(a) * r;
      if (terrainHeight(x, z, seed) < WATER_LEVEL) continue;
      const facing = Math.atan2(LAKE.x - x, LAKE.z - z);
      if (hasFishableWaterAhead(x, z, facing, seed)) return { x, z, facing };
    }
  }
  throw new Error('No dry Mirror Lake fishing spot found');
}

function deepfenFishingSpot(seed: number) {
  for (let r = DEEPFEN_SHALLOWS_LAKE.radius * 0.7; r <= DEEPFEN_SHALLOWS_LAKE.radius + 10; r += 1) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = DEEPFEN_SHALLOWS_LAKE.x + Math.cos(a) * r;
      const z = DEEPFEN_SHALLOWS_LAKE.z + Math.sin(a) * r;
      if (terrainHeight(x, z, seed) < WATER_LEVEL) continue;
      const facing = Math.atan2(DEEPFEN_SHALLOWS_LAKE.x - x, DEEPFEN_SHALLOWS_LAKE.z - z);
      if (hasFishableWaterAhead(x, z, facing, seed)) return { x, z, facing };
    }
  }
  throw new Error('No dry Deepfen Shallows fishing spot found');
}

describe('food, drink, vendor', () => {
  it('eating restores health over time while sitting and stands on move', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    sim.addItem('baked_bread', 1);
    sim.player.hp = 20;
    sim.player.combatTimer = 99;
    sim.player.inCombat = false;
    const breadBefore = sim.countItem('baked_bread');
    sim.useItem('baked_bread');
    expect(sim.player.sitting).toBe(true);
    expect(sim.countItem('baked_bread')).toBe(breadBefore - 1);
    const hpBefore = sim.player.hp;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(sim.player.hp).toBeGreaterThan(hpBefore);
    // moving stands up and stops the meal
    sim.moveInput.forward = true;
    sim.tick();
    expect(sim.player.sitting).toBe(false);
    expect(sim.player.eating).toBe(null);
    expect(sim.player.drinking).toBe(null);
  });

  it('eats and drinks at the same time', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.addItem('baked_bread', 1);
    sim.addItem('spring_water', 1);
    sim.player.hp = 20;
    sim.player.resource = 10;
    sim.player.combatTimer = 99;
    sim.player.inCombat = false;
    sim.useItem('baked_bread');
    sim.useItem('spring_water');
    expect(sim.player.eating).not.toBe(null);
    expect(sim.player.drinking).not.toBe(null);
    expect(sim.player.sitting).toBe(true);
    const hpBefore = sim.player.hp;
    const manaBefore = sim.player.resource;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(sim.player.hp).toBeGreaterThan(hpBefore);
    expect(sim.player.resource).toBeGreaterThan(manaBefore);
    // both still ticking after 6 of the 18 seconds
    expect(sim.player.eating).not.toBe(null);
    expect(sim.player.drinking).not.toBe(null);
    // taking damage interrupts both
    (sim as any).dealDamage(null, sim.player, 1, false, 'physical', 'Test', 'hit', true);
    expect(sim.player.eating).toBe(null);
    expect(sim.player.drinking).toBe(null);
  });

  it('combat potions restore instantly, work in combat, and share a cooldown (#103)', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.addItem('minor_mana_potion', 2);
    sim.player.resource = 10;
    sim.player.inCombat = true; // potions ignore the combat lockout that blocks food/drink
    sim.player.combatTimer = 99;

    sim.useItem('minor_mana_potion');
    expect(sim.player.resource).toBe(10 + (ITEMS.minor_mana_potion.potionMana ?? 0)); // instant, no sitting
    expect(sim.player.sitting).toBe(false);
    expect(sim.countItem('minor_mana_potion')).toBe(1);

    // second potion is blocked by the shared cooldown
    const afterFirst = sim.player.resource;
    sim.useItem('minor_mana_potion');
    expect(sim.player.resource).toBe(afterFirst);
    expect(sim.countItem('minor_mana_potion')).toBe(1); // not consumed
  });

  it('a mana potion is not wasted (consumed + put on cooldown) at full mana', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.addItem('minor_mana_potion', 1);
    sim.player.resource = sim.player.maxResource; // already topped off

    sim.useItem('minor_mana_potion');
    // nothing to restore: the potion stays in the bag and the shared
    // cooldown is never armed (mirrors the at-full-health guard for HP potions)
    expect(sim.player.resource).toBe(sim.player.maxResource);
    expect(sim.countItem('minor_mana_potion')).toBe(1);
    expect(sim.player.potionCooldownUntil).toBeLessThanOrEqual(sim.time);
  });

  it('out-of-combat mana regen is brisk and scales past the old spi/4+2 rate (#103)', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.setPlayerLevel(10);
    sim.player.resource = 0;
    sim.player.inCombat = false;
    sim.player.combatTimer = 0;
    sim.player.fiveSecondRule = 99; // out of combat, past the 5s rule
    const spi = sim.player.stats.spi;
    const oldRatePer2s = spi / 4 + 2;
    for (let i = 0; i < 20 * 2; i++) sim.tick(); // one 2s regen tick
    expect(sim.player.resource).toBeGreaterThan(oldRatePer2s); // faster than before
  });

  it('mage conjures water and drinking restores mana', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.setPlayerLevel(4);
    sim.castAbility('conjure_water');
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(sim.countItem('conjured_water')).toBe(2);
    sim.player.resource = 10;
    sim.player.combatTimer = 99;
    sim.player.inCombat = false;
    sim.tick();
    sim.useItem('conjured_water');
    const before = sim.player.resource;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(sim.player.resource).toBeGreaterThan(before);
  });

  it('mage conjures food and eating restores health', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.setPlayerLevel(6);
    sim.castAbility('conjure_food');
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(sim.countItem('conjured_bread')).toBe(2);
    sim.player.hp = 10;
    sim.player.combatTimer = 99;
    sim.player.inCombat = false;
    sim.tick();
    sim.useItem('conjured_bread');
    const before = sim.player.hp;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(sim.player.hp).toBeGreaterThan(before);
  });

  it('higher conjure food rank yields the heartier tier', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'mage');
    sim.setPlayerLevel(18);
    sim.castAbility('conjure_food');
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(sim.countItem('conjured_bread3')).toBe(2);
  });

  it('vendor buys and sells', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 200;
    const breadBefore = sim.countItem('baked_bread');
    sim.buyItem(wilkes.id, 'baked_bread');
    expect(sim.countItem('baked_bread')).toBe(breadBefore + 5); // food is sold in a stack of 5
    expect(sim.copper).toBe(75); // 200 - 125 (buyValue 25 per unit x the stack of 5)
    sim.addItem('wolf_fang', 2);
    sim.sellItem('wolf_fang');
    expect(sim.copper).toBe(79);
    expect(sim.countItem('wolf_fang')).toBe(1);
  });

  it('vendor buyback restores recently sold gear for the sale price', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.addItem('apprentice_staff', 1);

    sim.sellItem('apprentice_staff');

    expect(sim.countItem('apprentice_staff')).toBe(0);
    expect(sim.vendorBuyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);
    expect(sim.copper).toBe(120);

    sim.buyBackItem('apprentice_staff');

    expect(sim.countItem('apprentice_staff')).toBe(1);
    expect(sim.vendorBuyback).toEqual([]);
    expect(sim.copper).toBe(0);
  });

  it('vendor buyback round-trips through saved character state', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.addItem('apprentice_staff', 1);
    sim.sellItem('apprentice_staff');

    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.vendorBuyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);

    const sim2 = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: VENDOR_TEST_WORLD,
    });
    const pid2 = sim2.addPlayer('warrior', 'Saved', { state });
    const wilkes2 = [...sim2.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim2, wilkes2.pos.x + 2, wilkes2.pos.z);

    expect(sim2.meta(pid2)?.vendorBuyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);
    sim2.buyBackItem('apprentice_staff', undefined, undefined, pid2);
    expect(sim2.countItem('apprentice_staff', pid2)).toBe(1);
    expect(sim2.meta(pid2)?.vendorBuyback).toEqual([]);
  });

  it('vendor buyback requires money and keeps only recent sold item groups', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: VENDOR_TEST_WORLD,
    });
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.addItem('wolf_fang', 2);
    sim.sellItem('wolf_fang');
    sim.sellItem('wolf_fang');
    expect(sim.vendorBuyback).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    sim.copper = 0;

    sim.buyBackItem('wolf_fang');

    expect(sim.countItem('wolf_fang')).toBe(0);
    expect(sim.vendorBuyback).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'Not enough money.',
      pid: sim.player.id,
    });

    const itemIds = [
      'bandit_bandana',
      'tough_jerky',
      'mudfin_scale',
      'tallow_candle',
      'spider_leg',
      'bone_fragments',
      'linen_scrap',
      'baked_bread',
      'spring_water',
      'roasted_boar',
      'worn_sword',
      'hickory_shortstaff',
      'apprentice_staff',
    ];
    for (const itemId of itemIds) {
      sim.addItem(itemId, 1);
      sim.sellItem(itemId);
    }

    expect(sim.vendorBuyback).toHaveLength(12);
    expect(sim.vendorBuyback[0]).toEqual({ itemId: 'apprentice_staff', count: 1 });
    expect(sim.vendorBuyback.some((s) => s.itemId === 'wolf_fang')).toBe(false);
  });

  it('Sell Junk bulk-sells only gray items, sparing quest items and better gear', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 0;
    // wolf_fang is a crafting reagent now (quality common, never
    // swept), so this sweep uses mudfin_scale as its gray fodder.
    sim.addItem('mudfin_scale', 2); // poor (gray), sellValue 5 -> 10
    sim.addItem('bandit_bandana', 1); // poor (gray), sellValue 6
    sim.addItem('wolf_fang', 1); // reagent (common, white) -> kept
    sim.addItem('apprentice_staff', 1); // not poor -> kept
    sim.addItem('boar_hide', 1); // quest item -> kept

    sim.sellAllJunk();

    // only the gray items leave the bags
    expect(sim.countItem('mudfin_scale')).toBe(0);
    expect(sim.countItem('bandit_bandana')).toBe(0);
    expect(sim.countItem('wolf_fang')).toBe(1);
    expect(sim.countItem('apprentice_staff')).toBe(1);
    expect(sim.countItem('boar_hide')).toBe(1);
    // proceeds = 2*5 + 6 = 16 copper
    expect(sim.copper).toBe(16);
    // each sold gray stack is recorded for buyback
    expect(sim.vendorBuyback.some((s) => s.itemId === 'mudfin_scale' && s.count === 2)).toBe(true);
    expect(sim.vendorBuyback.some((s) => s.itemId === 'bandit_bandana' && s.count === 1)).toBe(
      true,
    );
    // exactly one summary loot line (not one per stack)
    const sold = sim.events.filter((e) => e.type === 'loot' && /^Sold /.test(e.text));
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ text: 'Sold 3 junk items for 16c.' });
  });

  it('Sell Junk needs a vendor in range and no-ops cleanly with nothing to sell', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;

    // far from any merchant: refuses, sells nothing
    sim.addItem('wolf_fang', 1);
    sim.sellAllJunk();
    expect(sim.countItem('wolf_fang')).toBe(1);
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'There is no merchant nearby.',
      pid: sim.player.id,
    });

    // at the vendor with no gray items: silent no-op (button is disabled in the UI)
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.removeItem('wolf_fang', 1);
    sim.addItem('apprentice_staff', 1); // not gray
    sim.copper = 0;
    const before = sim.events.length;
    sim.sellAllJunk();
    expect(sim.countItem('apprentice_staff')).toBe(1);
    expect(sim.copper).toBe(0);
    expect(sim.events.length).toBe(before); // nothing emitted
  });

  it('Fisherman Brandt sells a simple fishing pole', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const brandt = [...sim.entities.values()].find((e) => e.templateId === 'fisherman_brandt')!;
    teleportTo(sim, brandt.pos.x + 2, brandt.pos.z);
    sim.copper = 100;
    sim.buyItem(brandt.id, 'simple_fishing_pole');
    expect(sim.countItem('simple_fishing_pole')).toBe(1);
    expect(sim.copper).toBe(80);
  });

  it('a general vendor in each of zone 2 and 3 also sells a simple fishing pole', () => {
    for (const templateId of ['provisioner_hale', 'quartermaster_bree']) {
      expect(NPCS[templateId].vendorItems).toContain('simple_fishing_pole');
    }
    expect(NPCS.trader_wilkes.vendorItems).not.toContain('simple_fishing_pole');
  });

  it('rejects fishing away from fishable water', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.countItem('simple_fishing_pole')).toBe(1);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: 'You need to face fishable water.',
      }),
    );
  });

  it('starts the capped fishing session near and facing Mirror Lake with the one bite-delay draw', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = mirrorLakeFishingSpot(sim.cfg.seed);
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    // The cast start draws EXACTLY the one hidden bite delay; the
    // visible timer is the constant session cap and leaks nothing.
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.useItem('simple_fishing_pole');
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(1);
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);
    // Literal 15, not the imported constant: the broadcast session cap is a
    // wire-visible contract, so this pin must red if the constant moves (the
    // packet's constant-self-comparison trap).
    expect(sim.player.castTotal).toBe(15);
    expect(sim.player.castRemaining).toBe(15);
    expect(sim.player.channeling).toBe(false);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'castStart',
        ability: FISHING_CAST_ID,
        time: 15,
      }),
    );
  });

  it('rolls the fishing catch table only at a reel press inside the bite window', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = mirrorLakeFishingSpot(sim.cfg.seed);
    despawnMobs(sim);
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    expect(valeCatchCount(sim)).toBe(0);

    // Tick the LIVE loop to the bite (the hidden seeded delay caps at 8 s);
    // nothing rolls and nothing lands while the line is merely waiting.
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 10 && !events.some((e) => e.type === 'fishingBite'); i++) {
      events.push(...sim.tick());
    }
    expect(events.some((e) => e.type === 'fishingBite')).toBe(true);
    expect(valeCatchCount(sim)).toBe(0);
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);

    // The reel press inside the window resolves the single table draw (which
    // may still be the empty-hook row) and ends the session.
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    const catchCount = valeCatchCount(sim);
    expect(sim.player.castingAbility).toBe(null);
    expect(catchCount === 1 || catchCount === 0).toBe(true);
    if (catchCount === 0) {
      expect(sim.events).toContainEqual(
        expect.objectContaining({
          type: 'log',
          text: 'No fish are biting.',
        }),
      );
    }
    expect(sim.countItem('simple_fishing_pole')).toBe(1);
  });

  it('catches The Codfather in Deepfen Shallows while its quest is active', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = deepfenFishingSpot(sim.cfg.seed);
    const meta = sim.meta(sim.playerId)!;
    meta.questLog.set('q_the_codfather', {
      questId: 'q_the_codfather',
      counts: [0],
      state: 'active',
    });
    despawnMobs(sim);
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.addItem('simple_fishing_pole', 1);
    // The Deepfen Shallows are Mirefen water, which takes the tier-2 rod
    // (professions/fishing_zones.ts). The pole stays in the bags because the
    // not-consumed assertion at the end is about the item pressed, and the
    // press still routes through the pole.
    sim.addItem('ironreel_fishing_rod', 1);
    sim.useItem('simple_fishing_pole');
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);

    // Drive the bite, then reel: the codfather force-lands at the reel press
    // (its early return rolls no table), never before it.
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 10 && !events.some((e) => e.type === 'fishingBite'); i++) {
      events.push(...sim.tick());
    }
    expect(events.some((e) => e.type === 'fishingBite')).toBe(true);
    expect(sim.countItem('the_codfather')).toBe(0);
    sim.events = [];
    sim.useItem('simple_fishing_pole'); // the reel
    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'castStop', success: true }));
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.countItem('the_codfather')).toBe(1);
    sim.tick();
    expect(sim.questState('q_the_codfather')).toBe('ready');
    expect(sim.countItem('simple_fishing_pole')).toBe(1);
  });

  it('does not catch The Codfather without the active quest or outside Deepfen Shallows', () => {
    const deepfenSim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const deepfenSpot = deepfenFishingSpot(deepfenSim.cfg.seed);
    despawnMobs(deepfenSim);
    teleportTo(deepfenSim, deepfenSpot.x, deepfenSpot.z);
    deepfenSim.player.facing = deepfenSpot.facing;
    deepfenSim.addItem('simple_fishing_pole', 1);
    // Mirefen water takes the tier-2 rod. Without it the cast would be
    // refused and this test would pass for the wrong reason: no codfather
    // because no session, rather than no codfather because no quest.
    deepfenSim.addItem('ironreel_fishing_rod', 1);
    deepfenSim.useItem('simple_fishing_pole');
    expect(deepfenSim.player.castingAbility).toBe(FISHING_CAST_ID);
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 10 && !events.some((e) => e.type === 'fishingBite'); i++) {
      events.push(...deepfenSim.tick());
    }
    expect(events.some((e) => e.type === 'fishingBite')).toBe(true);
    deepfenSim.useItem('simple_fishing_pole'); // reel: at most a normal table catch
    expect(deepfenSim.countItem('the_codfather')).toBe(0);
  });

  it('does not catch The Codfather outside Deepfen Shallows even with the active quest', () => {
    const mirrorSim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const mirrorSpot = mirrorLakeFishingSpot(mirrorSim.cfg.seed);
    mirrorSim.meta(mirrorSim.playerId)?.questLog.set('q_the_codfather', {
      questId: 'q_the_codfather',
      counts: [0],
      state: 'active',
    });
    despawnMobs(mirrorSim);
    teleportTo(mirrorSim, mirrorSpot.x, mirrorSpot.z);
    mirrorSim.player.facing = mirrorSpot.facing;
    mirrorSim.addItem('simple_fishing_pole', 1);
    mirrorSim.useItem('simple_fishing_pole');
    const mirrorEvents: SimEvent[] = [];
    for (let i = 0; i < 20 * 10 && !mirrorEvents.some((e) => e.type === 'fishingBite'); i++) {
      mirrorEvents.push(...mirrorSim.tick());
    }
    mirrorSim.useItem('simple_fishing_pole'); // reel
    expect(mirrorSim.countItem('the_codfather')).toBe(0);
  });

  it('movement cancels fishing before any catch is granted', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = mirrorLakeFishingSpot(sim.cfg.seed);
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    sim.moveInput.forward = true;
    const events = sim.tick();
    expect(sim.player.castingAbility).toBe(null);
    expect(valeCatchCount(sim)).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'castStop',
        success: false,
      }),
    );
  });

  it('does not consume items while fishing is casting', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = mirrorLakeFishingSpot(sim.cfg.seed);
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.addItem('simple_fishing_pole', 1);
    sim.addItem('baked_bread', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    sim.events = [];
    const breadBefore = sim.countItem('baked_bread');
    sim.useItem('baked_bread');
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);
    expect(sim.countItem('baked_bread')).toBe(breadBefore);
    expect(sim.player.eating).toBe(null);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: 'You are busy.',
      }),
    );
  });

  it('rejects fishing while in combat', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = mirrorLakeFishingSpot(sim.cfg.seed);
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.player.inCombat = true;
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: "You can't do that while in combat.",
      }),
    );
  });

  it('rejects fishing while swimming', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    teleportTo(sim, LAKE.x, LAKE.z);
    sim.player.facing = 0;
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: "You can't do that while swimming.",
      }),
    );
  });

  it('damage cancels fishing instead of applying spell pushback', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const spot = mirrorLakeFishingSpot(sim.cfg.seed);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleportTo(sim, spot.x, spot.z);
    sim.player.facing = spot.facing;
    sim.addItem('simple_fishing_pole', 1);
    sim.events = [];
    sim.useItem('simple_fishing_pole');
    (sim as any).dealDamage(wolf, sim.player, 1, false, 'physical', null, 'hit');
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.player.castRemaining).toBe(0);
    expect(valeCatchCount(sim)).toBe(0);
  });

  it('fishing draws only from the zone the angler is standing in', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const meta = sim.meta(sim.player.id)!;
    // Eastbrook Vale water: every catch must come from the Vale table, never a
    // marsh/heights fish, and never an item outside the catch list.
    const valeIds = new Set(VALE_CATCHES);
    const preexisting = new Set(meta.inventory.map((s) => s.itemId)); // starter rations etc.
    for (let i = 0; i < 400; i++) completeFishing(sim.ctx, sim.player, meta);
    for (const slot of meta.inventory) {
      if (preexisting.has(slot.itemId)) continue;
      expect(valeIds.has(slot.itemId)).toBe(true);
    }
    // Over 400 casts the Vale's two staple fish should both show up.
    expect(sim.countItem('raw_mirror_trout')).toBeGreaterThan(0);
    expect(sim.countItem('raw_river_perch')).toBeGreaterThan(0);
    // None of the deeper-zone fish can be reeled from the Vale.
    expect(sim.countItem('raw_marsh_pike')).toBe(0);
    expect(sim.countItem('raw_frostgill_trout')).toBe(0);
  });

  it('fishing catches are replay-deterministic for a fixed seed', () => {
    const reel = () => {
      const sim = makeScopedSim(EMPTY_TEST_WORLD, 'warrior', 1234);
      const meta = sim.meta(sim.player.id)!;
      const caught: string[] = [];
      for (let i = 0; i < 30; i++) {
        const before = meta.inventory.reduce((n, s) => n + s.count, 0);
        completeFishing(sim.ctx, sim.player, meta);
        const after = meta.inventory.reduce((n, s) => n + s.count, 0);
        caught.push(after > before ? meta.inventory[meta.inventory.length - 1].itemId : 'nothing');
      }
      return caught;
    };
    expect(reel()).toEqual(reel());
  });

  it('a rare catch announces itself in the combat log', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const meta = sim.meta(sim.player.id)!;
    let sawRare = false;
    for (let i = 0; i < 400 && !sawRare; i++) {
      sim.events = [];
      completeFishing(sim.ctx, sim.player, meta);
      if (sim.events.some((e) => e.type === 'log' && /rare catch/i.test((e as any).text))) {
        sawRare = true;
        expect(sim.countItem('glimmerfin_koi')).toBeGreaterThan(0);
      }
    }
    expect(sawRare).toBe(true);
  });

  it('vendor buy rejects stale or invalid merchants with feedback', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 40, wilkes.pos.z);
    sim.copper = 100;
    sim.events = [];
    const breadBefore = sim.countItem('baked_bread');

    sim.buyItem(wilkes.id, 'baked_bread');

    expect(sim.countItem('baked_bread')).toBe(breadBefore);
    expect(sim.events).toContainEqual({ type: 'error', text: 'Too far away.', pid: sim.player.id });
  });

  it('vendor sells stack quantities without exceeding what the player has', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.addItem('wolf_fang', 5);

    sim.sellItem('wolf_fang', 3);

    expect(sim.copper).toBe(12);
    expect(sim.countItem('wolf_fang')).toBe(2);

    sim.sellItem('wolf_fang', 99);

    expect(sim.copper).toBe(20);
    expect(sim.countItem('wolf_fang')).toBe(0);
  });

  // Regression: "Sell amount to NPC" (Discord #bug-reports, Corotexus). A custom
  // amount typed into the sell-quantity dialog above one stack's size (wolf_fang
  // has no explicit stackSize, so it defaults to 20, see sim/bags.ts stackSizeOf)
  // must sell the FULL amount by pulling from every stack the player holds, not
  // silently cap at one stack's worth.
  it('vendor sells a custom amount greater than one stack size, drawing from every stack', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.addItem('wolf_fang', 100); // spread across five 20-stacks
    expect(sim.inventory.filter((s) => s.itemId === 'wolf_fang')).toHaveLength(5);

    sim.sellItem('wolf_fang', 100);

    expect(sim.copper).toBe(400);
    expect(sim.countItem('wolf_fang')).toBe(0);
  });

  it('vendor ignores invalid sell quantities', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.addItem('wolf_fang', 2);

    sim.sellItem('wolf_fang', 0);
    sim.sellItem('wolf_fang', -1);

    expect(sim.copper).toBe(0);
    expect(sim.countItem('wolf_fang')).toBe(2);
  });

  it('discarding quest items removes them without vendor payout or buyback', () => {
    const sim = makeScopedSim(VENDOR_TEST_WORLD, 'warrior');
    const meta = sim.meta(sim.playerId)!;
    meta.questLog.set('q_widows', { questId: 'q_widows', counts: [10, 0], state: 'active' });
    sim.addItem('widow_venom_sac', 6);
    expect(meta.questLog.get('q_widows')).toMatchObject({ counts: [10, 6], state: 'ready' });
    sim.events = [];

    sim.discardItem('widow_venom_sac', 2);

    expect(sim.countItem('widow_venom_sac')).toBe(4);
    expect(sim.copper).toBe(0);
    expect(sim.vendorBuyback).toEqual([]);
    expect(meta.questLog.get('q_widows')).toMatchObject({ counts: [10, 4], state: 'active' });
    expect(sim.events).toContainEqual({
      type: 'log',
      text: 'Discarded Widow Venom Sac x2.',
      color: '#999',
      pid: sim.player.id,
    });
  });
});

describe('quests', () => {
  it('full wolf quest flow: accept, kill 8, turn in', () => {
    const sim = makeScopedSim(QUESTS_TEST_WORLD, 'warrior');
    teleportTo(sim, 4, 4);
    sim.interact();
    expect(sim.questState('q_wolves')).toBe('active');
    const wolves = [...sim.entities.values()].filter((e) => e.templateId === 'forest_wolf');
    expect(wolves.length).toBeGreaterThanOrEqual(8);
    for (let k = 0; k < 8; k++) {
      const wolf = wolves[k];
      wolf.hp = 1;
      teleportTo(sim, wolf.pos.x + 2, wolf.pos.z);
      sim.targetEntity(wolf.id);
      sim.startAutoAttack();
      for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
        facePlayerAt(sim, wolf);
        sim.tick();
      }
      expect(wolf.dead).toBe(true);
    }
    expect(sim.questState('q_wolves')).toBe('ready');
    teleportTo(sim, 4, 4);
    sim.interact();
    expect(sim.questState('q_wolves')).toBe('done');
    expect(sim.questState('q_bandits')).toBe('available');
    expect(sim.questState('q_greyjaw')).toBe('available');
  });

  it('collect quest tracks inventory and consumes items on turn-in', () => {
    const sim = makeScopedSim(QUESTS_TEST_WORLD, 'warrior');
    const giver = NPCS[QUESTS.q_boars.giverNpcId];
    if (!giver) throw new Error('q_boars giver fixture missing');
    teleportTo(sim, giver.pos.x, giver.pos.z);
    sim.interact();
    expect(sim.questState('q_boars')).toBe('active');
    sim.addItem('boar_hide', 5);
    expect(sim.questState('q_boars')).toBe('ready');
    sim.interact();
    expect(sim.questState('q_boars')).toBe('done');
    expect(sim.countItem('boar_hide')).toBe(0);
  });

  it('quest accept and turn-in reject stale out-of-range dialogs with feedback', () => {
    const sim = makeScopedSim(QUESTS_TEST_WORLD, 'warrior');
    teleportTo(sim, 0, -40);
    sim.events = [];

    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('available');
    expect(sim.events).toContainEqual({ type: 'error', text: 'Too far away.', pid: sim.player.id });

    sim.events = [];
    sim.questLog.set('q_wolves', { questId: 'q_wolves', counts: [8], state: 'ready' });
    sim.turnInQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('ready');
    expect(sim.events).toContainEqual({ type: 'error', text: 'Too far away.', pid: sim.player.id });
  });

  it('ground objects can only be picked up with the quest active', () => {
    const sim = makePickupSim();
    sim.player.level = 3;
    const crate = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'supply_crate',
    )!;
    teleportTo(sim, crate.pos.x + 1, crate.pos.z);
    sim.pickUpObject(crate.id);
    expect(sim.countItem('supply_crate')).toBe(0);
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'The crate is nailed shut.',
      pid: sim.player.id,
    });
    sim.questLog.set('q_supplies', { questId: 'q_supplies', counts: [0], state: 'active' });
    sim.pickUpObject(crate.id);
    expect(sim.countItem('supply_crate')).toBe(1);
    expect(crate.lootable).toBe(false);
    // respawns
    for (let i = 0; i < 20 * 31; i++) sim.tick();
    expect(crate.lootable).toBe(true);
  });

  it('every ground object has custom pickup deny and enough lines', () => {
    const ids = [...new Set(GROUND_OBJECTS.map((o) => o.itemId))].sort();
    expect(Object.keys(GROUND_PICKUP_LINES).sort()).toEqual(ids);
    for (const id of ids) {
      expect(GROUND_PICKUP_LINES[id]?.deny, `${id} deny`).toBeTruthy();
      expect(GROUND_PICKUP_LINES[id]?.enough, `${id} enough`).toBeTruthy();
      expect(ITEMS[id]?.pickupDeny).toBe(GROUND_PICKUP_LINES[id].deny);
      expect(ITEMS[id]?.pickupEnough).toBe(GROUND_PICKUP_LINES[id].enough);
    }
  });

  it('ground object pickup uses item-specific enough message', () => {
    const sim = makePickupSim();
    sim.player.level = 3;
    const crate = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'supply_crate',
    )!;
    teleportTo(sim, crate.pos.x + 1, crate.pos.z);
    sim.questLog.set('q_supplies', { questId: 'q_supplies', counts: [0], state: 'active' });
    for (let i = 0; i < 4; i++) sim.addItem('supply_crate', 1);
    sim.events = [];
    sim.pickUpObject(crate.id);
    expect(sim.countItem('supply_crate')).toBe(4);
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'You already have enough supply crates.',
      pid: sim.player.id,
    });
  });

  it('quest reward weapon is granted and auto-equipped', () => {
    const sim = makeScopedSim(QUESTS_TEST_WORLD, 'warrior');
    teleportTo(sim, 4, 4);
    sim.interact();
    const qp = sim.questLog.get('q_wolves')!;
    qp.counts[0] = 8;
    (sim as any).ctx.checkQuestReady(qp, (sim as any).primary);
    sim.interact(); // turn in wolves
    // accept bandits specifically
    sim.acceptQuest('q_bandits');
    const qb = sim.questLog.get('q_bandits')!;
    qb.counts[0] = 10;
    (sim as any).ctx.checkQuestReady(qb, (sim as any).primary);
    sim.turnInQuest('q_bandits');
    expect(sim.equipment.mainhand).toBe('redbrook_blade');
  });
});

describe('RL interface', () => {
  it('observation has documented size and stays in sane bounds', () => {
    const sim = makeScopedSim(EMPTY_TEST_WORLD, 'warrior');
    const obs = encodeObs(sim);
    expect(obs.length).toBe(obsSize());
    for (const v of obs) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(2);
    }
  });

  it('actions execute without error and sim stays finite', () => {
    const sim = makeRlSim('rogue', 123);
    for (let step = 0; step < 600; step++) {
      applyAction(sim, step % ACTIONS.length);
      for (let t = 0; t < 4; t++) sim.tick();
      const obs = encodeObs(sim);
      for (const v of obs) expect(Number.isFinite(v)).toBe(true);
    }
  }, 90_000);

  it('same seed + same actions => identical trajectories', () => {
    const run = () => {
      const sim = makeRlSim('warrior', 999);
      const trace: number[] = [];
      for (let step = 0; step < 300; step++) {
        applyAction(sim, (step * 7) % ACTIONS.length);
        for (let t = 0; t < 4; t++) sim.tick();
        const o = encodeObs(sim);
        trace.push(o[0], o[4], o[5], sim.counters.damageDealt, sim.counters.xpGained);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  }, 90_000);
});
