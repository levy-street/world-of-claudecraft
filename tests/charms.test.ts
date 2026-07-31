import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateCharmBonus } from '../src/sim/charms';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemDef, PlayerClass } from '../src/sim/types';

// Charms grant their affixes from the BAGS. These pin the two halves separately:
// the pure aggregate (this file's first block, driven against plain slot lists) and
// the fold into recalcPlayerStats, which is the only place derived stats are built.

const CHARM: ItemDef = {
  id: 'test_charm',
  name: 'Test Charm',
  kind: 'charm',
  quality: 'epic',
  sellValue: 1,
  stats: { str: 2, agi: 3, sta: 4, int: 5, spi: 6, armor: 7 },
};

const RATING_CHARM: ItemDef = {
  id: 'test_rating_charm',
  name: 'Test Rating Charm',
  kind: 'charm',
  quality: 'epic',
  sellValue: 1,
  spellPower: 11,
  attackPower: 13,
  critRating: 17,
  hasteRating: 19,
  hitRating: 23,
  pvpOffenseRating: 29,
  pvpDefenseRating: 31,
};

// A non-charm carrying stats: proves the aggregate keys off the kind, not off the
// presence of a stats block (every gear piece has one).
const SWORD: ItemDef = {
  id: 'test_sword',
  name: 'Test Sword',
  kind: 'weapon',
  slot: 'mainhand',
  quality: 'common',
  sellValue: 1,
  weapon: { min: 1, max: 2, speed: 2 },
  stats: { str: 99 },
};

const TABLE: Record<string, ItemDef | undefined> = {
  test_charm: CHARM,
  test_rating_charm: RATING_CHARM,
  test_sword: SWORD,
};

const slot = (itemId: string, count = 1): InvSlot => ({ itemId, count });

describe('aggregateCharmBonus', () => {
  it('sums a carried charm, primaries and ratings alike', () => {
    const bonus = aggregateCharmBonus([slot('test_charm'), slot('test_rating_charm')], TABLE);
    expect(bonus.str).toBe(2);
    expect(bonus.agi).toBe(3);
    expect(bonus.sta).toBe(4);
    expect(bonus.int).toBe(5);
    expect(bonus.spi).toBe(6);
    expect(bonus.armor).toBe(7);
    expect(bonus.spellPower).toBe(11);
    expect(bonus.attackPower).toBe(13);
    expect(bonus.critRating).toBe(17);
    expect(bonus.hasteRating).toBe(19);
    expect(bonus.hitRating).toBe(23);
    expect(bonus.pvpOffenseRating).toBe(29);
    expect(bonus.pvpDefenseRating).toBe(31);
  });

  it('stacks DIFFERENT charm ids, and each contributes independently', () => {
    // Duplicates of one id do not stack, but two distinct charms both apply. Each
    // is asserted to move only its own fields, so a charm cannot silently inherit
    // or cancel another's contribution.
    const onlyStats = aggregateCharmBonus([slot('test_charm')], TABLE);
    const onlyRatings = aggregateCharmBonus([slot('test_rating_charm')], TABLE);
    const both = aggregateCharmBonus([slot('test_charm'), slot('test_rating_charm')], TABLE);

    // The stat charm carries no ratings, and the rating charm no primaries.
    expect(onlyStats.hitRating).toBe(0);
    expect(onlyRatings.str).toBe(0);

    // Together, every field is exactly the sum of the two taken alone.
    for (const key of Object.keys(both) as (keyof typeof both)[]) {
      expect(both[key], `field ${key} must be the sum of the two charms`).toBe(
        onlyStats[key] + onlyRatings[key],
      );
    }

    // And removing one leaves precisely the other's contribution behind.
    expect(aggregateCharmBonus([slot('test_rating_charm')], TABLE)).toEqual(onlyRatings);
  });

  it('counts one copy per charm id, whether stacked or in separate slots', () => {
    const stacked = aggregateCharmBonus([slot('test_charm', 5)], TABLE);
    const spread = aggregateCharmBonus(
      [slot('test_charm'), slot('test_charm'), slot('test_charm')],
      TABLE,
    );
    const single = aggregateCharmBonus([slot('test_charm')], TABLE);
    expect(stacked).toEqual(single);
    expect(spread).toEqual(single);
    expect(single.str).toBe(2);
  });

  it('ignores a non-charm that carries stats, and an empty stack', () => {
    expect(aggregateCharmBonus([slot('test_sword')], TABLE).str).toBe(0);
    expect(aggregateCharmBonus([slot('test_charm', 0)], TABLE).str).toBe(0);
  });

  it('is zeroed, not sparse, for an empty bag', () => {
    expect(aggregateCharmBonus([], TABLE)).toEqual({
      str: 0,
      agi: 0,
      sta: 0,
      int: 0,
      spi: 0,
      armor: 0,
      spellPower: 0,
      attackPower: 0,
      critRating: 0,
      hasteRating: 0,
      hitRating: 0,
      pvpOffenseRating: 0,
      pvpDefenseRating: 0,
    });
  });

  it('ignores an unknown item id rather than throwing', () => {
    expect(aggregateCharmBonus([slot('no_such_item')], TABLE).str).toBe(0);
  });
});

describe('recalcPlayerStats folds carried charms', () => {
  const statsFor = (cls: PlayerClass, inventory: InvSlot[]) => {
    const e: Entity = createPlayer(1, cls, { x: 0, y: 0, z: 0 }, 'Aleph');
    recalcPlayerStats(e, cls, {}, undefined, {}, inventory);
    return e;
  };

  it('adds the charm stats on top of the bare stat block', () => {
    const bare = statsFor('warrior', []);
    const held = statsFor('warrior', [{ itemId: 'hand_of_st_albus', count: 1 }]);
    expect(held.stats.str).toBe(bare.stats.str + 2);
    expect(held.stats.agi).toBe(bare.stats.agi + 2);
    expect(held.stats.sta).toBe(bare.stats.sta + 2);
    expect(held.stats.int).toBe(bare.stats.int + 2);
    expect(held.stats.spi).toBe(bare.stats.spi + 2);
  });

  it('leaves the stat block untouched when the bags are empty', () => {
    expect(statsFor('mage', []).stats).toEqual(statsFor('mage', []).stats);
  });

  // The affixes that are NOT primary stats land on derived fields rather than in
  // `stats`, so they need their own end-to-end assertion. attackPower especially:
  // it is a brand-new ItemDef field that no shipped item sets, so without this the
  // only thing exercising it is the pure aggregate. Injected into the real ITEMS
  // table because recalcPlayerStats resolves charm defs through it, and removed
  // again so no other suite sees a phantom item.
  describe('derived affixes reach their derived fields', () => {
    const AP_CHARM_ID = 'test_ap_hit_charm';
    const table = ITEMS as Record<string, ItemDef | undefined>;

    beforeAll(() => {
      table[AP_CHARM_ID] = {
        id: AP_CHARM_ID,
        name: 'Test Attack Power Charm',
        kind: 'charm',
        quality: 'epic',
        sellValue: 1,
        attackPower: 40,
        hitRating: 40,
      };
    });
    afterAll(() => {
      delete table[AP_CHARM_ID];
    });

    it('folds a charm attackPower into the derived attack power', () => {
      const bare = statsFor('warrior', []);
      const held = statsFor('warrior', [{ itemId: AP_CHARM_ID, count: 1 }]);
      // Flat AP adds before the percentage multiplier, and this character has no
      // apPct talents or buffs, so the delta is exactly the affix.
      expect(held.attackPower).toBe(bare.attackPower + 40);
    });

    it('folds a charm hitRating into the rating and its derived hit bonus', () => {
      const bare = statsFor('warrior', []);
      const held = statsFor('warrior', [{ itemId: AP_CHARM_ID, count: 1 }]);
      expect(held.hitRating).toBe(bare.hitRating + 40);
      // The rating converts to a fraction, so the derived bonus must move with it
      // rather than the rating landing somewhere inert.
      expect(held.hitBonus).toBeGreaterThan(bare.hitBonus);
    });
  });
});

describe('a charm in the bank is inert', () => {
  // Drives the REAL bank delegates through a banker, so the "bags, never the bank"
  // rule is pinned against the actual container move rather than a hand-edited list.
  const metaOf = (sim: Sim) =>
    (
      sim as unknown as {
        players: Map<
          number,
          { inventory: InvSlot[]; cls: PlayerClass; equipment: object; copper: number }
        >;
      }
    ).players.get(sim.playerId)!;

  // NEVER calls recalcPlayerStats itself. An earlier version of this test did, and
  // it passed against a build where banking the charm left the bonus applied in the
  // running game: the manual recalc was doing the very work the sim was missing.
  // Everything below asserts on stats the sim maintained on its own.
  it('drops the bonus on deposit and restores it on withdraw, with no manual recalc', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const banker = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'bursar_fernando',
    ) as Entity;
    const p = sim.entities.get(sim.playerId) as Entity;
    p.pos = { ...banker.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);

    const meta = metaOf(sim);
    const bare = p.stats.str;

    sim.addItem('hand_of_st_albus', 1);
    expect(p.stats.str, 'looting a charm applies it immediately').toBe(bare + 2);

    const idx = meta.inventory.findIndex((s) => s.itemId === 'hand_of_st_albus');
    sim.bankDeposit(idx);
    expect(meta.inventory.some((s) => s.itemId === 'hand_of_st_albus')).toBe(false);
    expect(p.stats.str, 'banking a charm drops its bonus').toBe(bare);

    sim.bankWithdraw(0);
    expect(meta.inventory.some((s) => s.itemId === 'hand_of_st_albus')).toBe(true);
    expect(p.stats.str, 'withdrawing restores it, and only once').toBe(bare + 2);
  });

  it('does not stack the bonus across repeated deposit/withdraw cycles', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const banker = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'bursar_fernando',
    ) as Entity;
    const p = sim.entities.get(sim.playerId) as Entity;
    p.pos = { ...banker.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);

    const meta = metaOf(sim);
    const bare = p.stats.str;
    sim.addItem('hand_of_st_albus', 1);
    for (let cycle = 0; cycle < 3; cycle++) {
      const idx = meta.inventory.findIndex((s) => s.itemId === 'hand_of_st_albus');
      sim.bankDeposit(idx);
      expect(p.stats.str, `cycle ${cycle}: deposited`).toBe(bare);
      sim.bankWithdraw(0);
      expect(p.stats.str, `cycle ${cycle}: withdrawn`).toBe(bare + 2);
    }
  });

  it('leaves the stat block alone when a NON-charm moves through the bank', () => {
    // The signature gate's other half: ordinary looting and banking must not pay
    // for a stat rebuild, and must not disturb the stats either.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const banker = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'bursar_fernando',
    ) as Entity;
    const p = sim.entities.get(sim.playerId) as Entity;
    p.pos = { ...banker.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);

    const meta = metaOf(sim);
    const before = { ...p.stats };
    sim.addItem('wolf_fang', 3);
    const idx = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.bankDeposit(idx);
    expect(p.stats).toEqual(before);
  });
});

describe('the mail cannot hold the assembled charm', () => {
  // Mail is the other container a player would try. Attachments live on the parcel
  // (MailMessage.items), never in the bags, so anything that leaves the bags stops
  // granting; the soulbound hand never gets that far.
  it('refuses to post the soulbound hand, so the bonus never leaves its owner', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('warrior', 'Bob');
    const box = sim.entities.get(sim.postOffice.mailboxIds[0])!;
    const p = sim.entities.get(alice)!;
    p.pos = { ...box.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);

    const meta = (
      sim as unknown as {
        players: Map<
          number,
          { inventory: InvSlot[]; cls: PlayerClass; equipment: object; copper: number }
        >;
      }
    ).players.get(alice)!;
    const bare = p.stats.str;
    sim.addItem('hand_of_st_albus', 1, alice);
    meta.copper += 10_000; // postage
    expect(p.stats.str).toBe(bare + 2);

    // The assembled hand is soulbound, so the Ravenpost refuses it outright: the
    // charm never reaches the escrow, and the bonus never leaves the owner.
    sim.mailSend(
      'Bob',
      'A gift',
      'Hold this.',
      0,
      [{ itemId: 'hand_of_st_albus', count: 1 }],
      alice,
    );
    expect(meta.inventory.some((s) => s.itemId === 'hand_of_st_albus')).toBe(true);
    expect(p.stats.str).toBe(bare + 2);
  });

  it('a tradeable finger still leaves the bags when mailed', () => {
    // The non-soulbound half of the pair: proves the refusal above is the
    // soulbound rule, not the Ravenpost quietly dropping every attachment.
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('warrior', 'Bob');
    const box = sim.entities.get(sim.postOffice.mailboxIds[0])!;
    const p = sim.entities.get(alice)!;
    p.pos = { ...box.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    const meta = (
      sim as unknown as {
        players: Map<
          number,
          { inventory: InvSlot[]; cls: PlayerClass; equipment: object; copper: number }
        >;
      }
    ).players.get(alice)!;

    sim.addItem('st_albus_index_finger', 1, alice);
    meta.copper += 10_000;
    sim.mailSend(
      'Bob',
      'A piece',
      'For your set.',
      0,
      [{ itemId: 'st_albus_index_finger', count: 1 }],
      alice,
    );
    expect(meta.inventory.some((s) => s.itemId === 'st_albus_index_finger')).toBe(false);
  });
});

describe('the shipped charm content', () => {
  it('The Hand of St. Albus is a legendary charm granting +2 to all five primaries', () => {
    const hand = ITEMS.hand_of_st_albus;
    expect(hand.kind).toBe('charm');
    expect(hand.quality).toBe('legendary');
    expect(hand.stats).toEqual({ str: 2, agi: 2, sta: 2, int: 2, spi: 2 });
  });
});
