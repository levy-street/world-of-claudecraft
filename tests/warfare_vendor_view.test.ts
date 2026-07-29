// The WARFARE quartermaster's shop view core: how the honor stock divides into
// its six sections, which offers read as owned, which set-bonus tiers are live,
// and how many pieces the NEXT unmet tier still wants. Node-only, driving the
// pure core directly (the DOM/i18n half lives in warfare_vendor_window.ts).
//
// The one number this window exists for is the owned-count line, so the
// next-tier arithmetic gets the most assertions here: a bare "5 of 7" fraction
// is the thing the window is replacing.

import { describe, expect, it } from 'vitest';
import { ITEM_SETS } from '../src/sim/content/item_sets';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { InvSlot, ItemDef, ItemSet } from '../src/sim/types';
import {
  buildWarfareVendorView,
  isWarfareVendorNpc,
  WARFARE_SHOP_JEWELRY_KEY,
  WARFARE_SHOP_SET_ORDER,
  WARFARE_SHOP_WEAPONS_KEY,
  type WarfareShopSetSection,
  type WarfareShopViewer,
  type WarfareShopWorld,
  warfareShopViewer,
} from '../src/ui/hud/vendor/warfare_vendor_view';
import { bareClient } from './helpers/bare_client';

const SET_A = 'fixture_set_a';
const SET_B = 'fixture_set_b';
const SLOTS = ['helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet'] as const;

function armor(setId: string, slot: string, honor: number): ItemDef {
  return {
    id: `${setId}_${slot}`,
    name: `${setId} ${slot}`,
    kind: 'armor',
    armorType: 'mail',
    slot,
    quality: 'epic',
    stats: {},
    priceHonor: honor,
    sellValue: 0,
    set: setId,
  } as unknown as ItemDef;
}

function jewel(id: string, slot: 'neck' | 'ring', honor = 275): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    slot,
    quality: 'epic',
    stats: {},
    priceHonor: honor,
    sellValue: 0,
  } as unknown as ItemDef;
}

function weapon(id: string, honor = 1200): ItemDef {
  return {
    id,
    name: id,
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    stats: {},
    priceHonor: honor,
    sellValue: 0,
  } as unknown as ItemDef;
}

/** Two 7-slot fixture families on 2/4/7 breakpoints, plus jewelry and a weapon. */
function fixture(): {
  stock: string[];
  items: Record<string, ItemDef>;
  sets: Record<string, ItemSet>;
} {
  const items: Record<string, ItemDef> = {};
  const stock: string[] = [];
  for (const setId of [SET_A, SET_B]) {
    for (const slot of SLOTS) {
      const def = armor(setId, slot, 100);
      items[def.id] = def;
      stock.push(def.id);
    }
  }
  for (const [id, slot] of [
    ['fix_neck', 'neck'],
    ['fix_ring_a', 'ring'],
    ['fix_ring_b', 'ring'],
  ] as const) {
    const def = jewel(id, slot);
    items[def.id] = def;
    stock.push(def.id);
  }
  const blade = weapon('fix_blade');
  items[blade.id] = blade;
  stock.push(blade.id);
  const bonuses = [
    { pieces: 2, effect: {}, text: 'two' },
    { pieces: 4, effect: {}, text: 'four' },
    { pieces: 7, effect: {}, text: 'seven' },
  ];
  const sets: Record<string, ItemSet> = {
    [SET_A]: { id: SET_A, name: 'Set A', bonuses: bonuses as ItemSet['bonuses'] },
    [SET_B]: { id: SET_B, name: 'Set B', bonuses: bonuses as ItemSet['bonuses'] },
  };
  return { stock, items, sets };
}

function viewer(over: Partial<WarfareShopViewer> = {}): WarfareShopViewer {
  return {
    honor: 100_000,
    ownedItemIds: new Set<string>(),
    equippedItemIds: new Set<string>(),
    ...over,
  };
}

function setSection(
  view: ReturnType<typeof buildWarfareVendorView>,
  setId: string,
): WarfareShopSetSection {
  const section = view.sections.find((s) => s.kind === 'set' && s.setId === setId);
  if (section?.kind !== 'set') throw new Error(`no set section for ${setId}`);
  return section;
}

describe('buildWarfareVendorView: sectioning', () => {
  it('splits the stock into set sections, then jewelry, then weapons', () => {
    const { stock, items, sets } = fixture();
    const view = buildWarfareVendorView(stock, items, sets, viewer());
    expect(view.sections.map((s) => s.key)).toEqual([
      SET_A,
      SET_B,
      WARFARE_SHOP_JEWELRY_KEY,
      WARFARE_SHOP_WEAPONS_KEY,
    ]);
    expect(view.sections.map((s) => s.kind)).toEqual(['set', 'set', 'jewelry', 'weapons']);
    expect(setSection(view, SET_A).offers.map((o) => o.itemId)).toHaveLength(7);
    const jewelrySection = view.sections.find((s) => s.key === WARFARE_SHOP_JEWELRY_KEY);
    expect(jewelrySection?.offers.map((o) => o.itemId)).toEqual([
      'fix_neck',
      'fix_ring_a',
      'fix_ring_b',
    ]);
    expect(
      view.sections.find((s) => s.key === WARFARE_SHOP_WEAPONS_KEY)?.offers.map((o) => o.itemId),
    ).toEqual(['fix_blade']);
  });

  it('lists named families in the authored order, unnamed families after', () => {
    expect(WARFARE_SHOP_SET_ORDER).toEqual([
      'warfare_furyforged',
      'warfare_stormbound',
      'warfare_ashstalker',
      'warfare_cinderweave',
      'warfare_thornhide',
    ]);
    // Stock deliberately lists the UNNAMED family first and the two named ones
    // out of authored order, so first-seen order and authored order disagree:
    // the authored pair must still come out furyforged-then-cinderweave, and
    // the unnamed family must still get a section rather than vanishing.
    const items: Record<string, ItemDef> = {};
    const stock: string[] = [];
    for (const setId of [SET_A, 'warfare_cinderweave', 'warfare_furyforged']) {
      for (const slot of SLOTS) {
        const def = armor(setId, slot, 100);
        items[def.id] = def;
        stock.push(def.id);
      }
    }
    const bonuses = [{ pieces: 2, effect: {}, text: 'two' }] as ItemSet['bonuses'];
    const sets: Record<string, ItemSet> = {
      [SET_A]: { id: SET_A, name: 'Set A', bonuses },
      warfare_cinderweave: { id: 'warfare_cinderweave', name: 'Cinderweave', bonuses },
      warfare_furyforged: { id: 'warfare_furyforged', name: 'Furyforged', bonuses },
    };
    const view = buildWarfareVendorView(stock, items, sets, viewer());
    expect(view.sections.map((s) => s.key)).toEqual([
      'warfare_furyforged',
      'warfare_cinderweave',
      SET_A,
    ]);
  });

  it('drops unknown ids and priceless rows, and never emits an empty section', () => {
    const { items, sets } = fixture();
    const free = armor(SET_A, 'helmet', 0);
    const view = buildWarfareVendorView(
      ['no_such_item', free.id, 'fix_neck'],
      { ...items, [free.id]: free },
      sets,
      viewer(),
    );
    expect(view.sections.map((s) => s.key)).toEqual([WARFARE_SHOP_JEWELRY_KEY]);
  });

  it('reports affordability against the honor balance without deciding anything', () => {
    const { stock, items, sets } = fixture();
    const view = buildWarfareVendorView(stock, items, sets, viewer({ honor: 100 }));
    const jewelryOffers =
      view.sections.find((s) => s.key === WARFARE_SHOP_JEWELRY_KEY)?.offers ?? [];
    // Armor is 100 honor here, jewelry 275, the weapon 1200.
    expect(setSection(view, SET_A).offers.every((o) => o.affordable)).toBe(true);
    expect(jewelryOffers.every((o) => o.affordable)).toBe(false);
    expect(view.balance).toBe(100);
  });
});

describe('buildWarfareVendorView: owned marks and set progress', () => {
  it('marks owned offers from bags and equipment alike', () => {
    const { stock, items, sets } = fixture();
    const view = buildWarfareVendorView(
      stock,
      items,
      sets,
      viewer({
        ownedItemIds: new Set([`${SET_A}_chest`, `${SET_A}_helmet`]),
        equippedItemIds: new Set([`${SET_A}_helmet`]),
      }),
    );
    const section = setSection(view, SET_A);
    expect(
      section.offers
        .filter((o) => o.owned)
        .map((o) => o.itemId)
        .sort(),
    ).toEqual([`${SET_A}_chest`, `${SET_A}_helmet`]);
    expect(section.ownedPieces).toBe(2);
    expect(section.equippedPieces).toBe(1);
    expect(section.totalPieces).toBe(7);
  });

  it('decides a tier is MET on what is worn, not on what is owned', () => {
    const { stock, items, sets } = fixture();
    const owned = new Set(SLOTS.map((slot) => `${SET_A}_${slot}`));
    const view = buildWarfareVendorView(
      stock,
      items,
      sets,
      viewer({ ownedItemIds: owned, equippedItemIds: new Set([`${SET_A}_helmet`]) }),
    );
    const section = setSection(view, SET_A);
    // Every piece bought, one worn: nothing is live yet, which is the same
    // claim the item tooltip's set block makes.
    expect(section.tiers).toEqual([
      { pieces: 2, met: false },
      { pieces: 4, met: false },
      { pieces: 7, met: false },
    ]);
    expect(section.nextTier).toBeNull();
  });

  it('lights exactly the tiers the equipped count reaches', () => {
    const { stock, items, sets } = fixture();
    const worn = new Set(['helmet', 'shoulder', 'chest', 'waist'].map((s) => `${SET_A}_${s}`));
    const section = setSection(
      buildWarfareVendorView(
        stock,
        items,
        sets,
        viewer({ ownedItemIds: worn, equippedItemIds: worn }),
      ),
      SET_A,
    );
    expect(section.tiers).toEqual([
      { pieces: 2, met: true },
      { pieces: 4, met: true },
      { pieces: 7, met: false },
    ]);
  });

  it('counts the NEXT unmet tier, never a bare fraction of the full set', () => {
    const { stock, items, sets } = fixture();
    const five = new Set(
      ['helmet', 'shoulder', 'chest', 'waist', 'legs'].map((s) => `${SET_A}_${s}`),
    );
    const atFive = setSection(
      buildWarfareVendorView(stock, items, sets, viewer({ ownedItemIds: five })),
      SET_A,
    );
    // The line the window exists for: "2 more for the 7-piece bonus", not 5/7.
    expect(atFive.ownedPieces).toBe(5);
    expect(atFive.nextTier).toEqual({ pieces: 7, remaining: 2 });

    const none = setSection(buildWarfareVendorView(stock, items, sets, viewer()), SET_A);
    expect(none.nextTier).toEqual({ pieces: 2, remaining: 2 });

    const three = new Set(['helmet', 'shoulder', 'chest'].map((s) => `${SET_A}_${s}`));
    const atThree = setSection(
      buildWarfareVendorView(stock, items, sets, viewer({ ownedItemIds: three })),
      SET_A,
    );
    expect(atThree.nextTier).toEqual({ pieces: 4, remaining: 1 });
  });

  it('counts distinct SLOTS, so a duplicate copy cannot inflate the progress', () => {
    const { stock, items, sets } = fixture();
    const dupe = { ...armor(SET_A, 'helmet', 100), id: `${SET_A}_helmet_dupe` };
    const section = setSection(
      buildWarfareVendorView(
        [...stock, dupe.id],
        { ...items, [dupe.id]: dupe },
        sets,
        viewer({ ownedItemIds: new Set([`${SET_A}_helmet`, dupe.id]) }),
      ),
      SET_A,
    );
    expect(section.offers).toHaveLength(8);
    expect(section.ownedPieces).toBe(1);
    expect(section.nextTier).toEqual({ pieces: 2, remaining: 1 });
  });

  it('takes the denominator from the shared member counts when one is supplied', () => {
    const { stock, items, sets } = fixture();
    const section = setSection(
      buildWarfareVendorView(stock, items, sets, viewer({ setMemberCounts: { [SET_A]: 9 } })),
      SET_A,
    );
    expect(section.totalPieces).toBe(9);
  });

  it('drops a tier the set can never reach (the tooltip model rule, no literals)', () => {
    const { items } = fixture();
    const short: Record<string, ItemSet> = {
      [SET_A]: {
        id: SET_A,
        name: 'Set A',
        bonuses: [
          { pieces: 2, effect: {}, text: 'two' },
          { pieces: 9, effect: {}, text: 'nine' },
        ] as ItemSet['bonuses'],
      },
    };
    const section = setSection(
      buildWarfareVendorView(
        SLOTS.map((slot) => `${SET_A}_${slot}`),
        items,
        short,
        viewer(),
      ),
      SET_A,
    );
    expect(section.tiers.map((tier) => tier.pieces)).toEqual([2]);
  });
});

describe('warfareShopViewer: the IWorld derivation, identical in both worlds', () => {
  // Round-2 review finding: this derivation used to live in hud.ts, untested,
  // and it is exactly where the offline Sim and the online ClientWorld mirror
  // shapes could diverge. Driven here against BOTH shapes with the same data.
  const CHEST = `${SET_A}_chest`;
  const HELM = `${SET_A}_helmet`;
  const POTION = 'minor_healing_potion';

  function simWorld(): WarfareShopWorld {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    // All three reads are GETTERS projecting off the primary PlayerMeta (which
    // is private, and is NOT the player Entity), so the fixture writes that
    // record: writing the Entity would leave every projection at its default.
    const internals = sim as unknown as {
      primaryId: number;
      players: Map<
        number,
        {
          honor: number;
          inventory: InvSlot[];
          equipment: Record<string, string | undefined>;
        }
      >;
    };
    const primary = internals.players.get(internals.primaryId);
    if (!primary) throw new Error('primary player meta missing');
    primary.honor = 4321;
    primary.equipment = { chest: CHEST };
    primary.inventory = [
      { itemId: HELM, count: 1 },
      { itemId: POTION, count: 5 },
    ];
    return sim;
  }

  function clientWorld(): WarfareShopWorld {
    const client = bareClient(1);
    client.honor = 4321;
    client.equipment = { chest: CHEST };
    client.inventory = [
      { itemId: HELM, count: 1 },
      { itemId: POTION, count: 5 },
    ];
    return client;
  }

  it('reads the balance, the WORN ids and the worn-or-carried ids off the seam', () => {
    for (const [label, world] of [
      ['Sim', simWorld()],
      ['ClientWorld', clientWorld()],
    ] as const) {
      const viewerModel = warfareShopViewer(world);
      expect(viewerModel.honor, label).toBe(4321);
      expect([...viewerModel.equippedItemIds].sort(), label).toEqual([CHEST]);
      expect([...viewerModel.ownedItemIds].sort(), label).toEqual([CHEST, HELM, POTION].sort());
    }
  });

  it('produces the SAME viewer from the Sim and the ClientWorld mirror', () => {
    const fromSim = warfareShopViewer(simWorld());
    const fromClient = warfareShopViewer(clientWorld());
    expect(fromClient.honor).toBe(fromSim.honor);
    expect([...fromClient.equippedItemIds].sort()).toEqual([...fromSim.equippedItemIds].sort());
    expect([...fromClient.ownedItemIds].sort()).toEqual([...fromSim.ownedItemIds].sort());
  });

  it('drops the empty equipment slots rather than counting them as worn ids', () => {
    const client = bareClient(2);
    client.honor = 0;
    client.equipment = { chest: CHEST, legs: undefined, helmet: '' };
    client.inventory = [];
    const viewerModel = warfareShopViewer(client);
    expect([...viewerModel.equippedItemIds]).toEqual([CHEST]);
    expect([...viewerModel.ownedItemIds]).toEqual([CHEST]);
  });

  it('floors nothing and reports the raw honor: the balance floor is the view builder', () => {
    const client = bareClient(3);
    client.honor = 12.5;
    expect(warfareShopViewer(client).honor).toBe(12.5);
    expect(
      buildWarfareVendorView([], {}, {}, { ...warfareShopViewer(client), setMemberCounts: {} })
        .balance,
    ).toBe(12);
  });

  it('does NOT see the bank: a stored piece reads as unowned (documented limitation)', () => {
    // IWorldBank.bankInfo is null away from a banker, so the shop genuinely
    // cannot observe stored gear. The consequence is a real one and is pinned
    // here so the next reader does not assume bank coverage: a piece parked in
    // the bank loses its Owned marker AND is missing from the owned-count line,
    // which can invite a duplicate purchase of an unrefundable honor item.
    const banked = bareClient(4);
    banked.honor = 1000;
    // Worn: nothing. Carried: nothing. The player owns the chest, in the bank.
    banked.equipment = {};
    banked.inventory = [];
    const viewerModel = warfareShopViewer(banked);
    expect(viewerModel.ownedItemIds.has(CHEST)).toBe(false);

    const { stock, items, sets } = fixture();
    const section = setSection(buildWarfareVendorView(stock, items, sets, viewerModel), SET_A);
    expect(section.offers.find((o) => o.itemId === CHEST)?.owned).toBe(false);
    expect(section.ownedPieces).toBe(0);
    // The progress line therefore UNDERCOUNTS by the banked piece: it asks for
    // two more when the player is one purchase away from the 2-piece tier.
    expect(section.nextTier).toEqual({ pieces: 2, remaining: 2 });
  });
});

describe('isWarfareVendorNpc', () => {
  it('gates on the NpcDef flag, never on an npc id', () => {
    expect(isWarfareVendorNpc(undefined)).toBe(false);
    expect(isWarfareVendorNpc({ id: 'fury' })).toBe(false);
    expect(isWarfareVendorNpc({ id: 'anything', warfareVendor: true })).toBe(true);
  });
});

describe('buildWarfareVendorView over the shipped WARFARE stock', () => {
  it('renders the four shipped families in order, each of seven pieces, plus jewelry and weapons', () => {
    const view = buildWarfareVendorView(FURY_STOCK, ITEMS, ITEM_SETS, viewer());
    expect(view.sections.map((s) => s.key)).toEqual([
      ...WARFARE_SHOP_SET_ORDER,
      WARFARE_SHOP_JEWELRY_KEY,
      WARFARE_SHOP_WEAPONS_KEY,
    ]);
    for (const setId of WARFARE_SHOP_SET_ORDER) {
      const section = setSection(view, setId);
      expect(section.offers, setId).toHaveLength(7);
      expect(section.totalPieces, setId).toBe(7);
      // The whole point of the phase-2 breakpoint work: the 7-piece capstone is
      // reachable, so it renders instead of being filtered away.
      expect(
        section.tiers.map((tier) => tier.pieces),
        setId,
      ).toEqual([2, 4, 7]);
      expect(section.nextTier, setId).toEqual({ pieces: 2, remaining: 2 });
    }
    expect(view.sections.find((s) => s.key === WARFARE_SHOP_JEWELRY_KEY)?.offers).toHaveLength(9);
    expect(view.sections.find((s) => s.key === WARFARE_SHOP_WEAPONS_KEY)?.offers).toHaveLength(3);
  });

  it('reaches the capstone once all seven of a family are worn', () => {
    const furyforged = Object.values(ITEMS)
      .filter((item) => item.set === 'warfare_furyforged')
      .map((item) => item.id);
    expect(furyforged).toHaveLength(7);
    const view = buildWarfareVendorView(
      FURY_STOCK,
      ITEMS,
      ITEM_SETS,
      viewer({
        ownedItemIds: new Set(furyforged),
        equippedItemIds: new Set(furyforged),
      }),
    );
    const section = setSection(view, 'warfare_furyforged');
    expect(section.tiers.every((tier) => tier.met)).toBe(true);
    expect(section.nextTier).toBeNull();
  });
});
