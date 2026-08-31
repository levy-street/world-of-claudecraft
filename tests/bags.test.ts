// WoW-style bag system (src/sim/bags.ts): stack sizes, the pooled capacity
// budget (16-slot backpack + 4 equippable bag sockets), the capacity gates at
// the command boundaries, equip/unequip/swap rules, and save back-compat.
import { describe, expect, it } from 'vitest';
import { isMaterialsOnlyBag, type PoolCapacity } from '../src/sim/bag_pools';
import {
  addStacked,
  BACKPACK_SLOTS,
  BAG_SOCKETS,
  bagCapacity,
  bagPools,
  canAddItem,
  canGrantCopies,
  canGrantItemInstance,
  consumeOneScratch,
  countFit,
  fitsAll,
  freeBagSlotsFor,
  instancedCountCap,
  MIGRATION_BAGS,
  migrationBagsFor,
  stackSizeOf,
} from '../src/sim/bags';
import { ALL_RECIPES, ITEMS } from '../src/sim/data';
import { removePreferFungible } from '../src/sim/items';
import { materialItemIds } from '../src/sim/material_ids';
// material_taxonomy.ts derives EAGERLY and is therefore banned INSIDE src/sim
// (the module-evaluation cycle rule); a test may import it, and this one must,
// to hold the sim-side lazy set and the UI-side eager set to one taxonomy.
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { isCommissionEligibleKind } from '../src/sim/professions/commission';
import { mintsSignedCraftOutput } from '../src/sim/professions/crafting';
import { isEnchantedInstance } from '../src/sim/professions/enchanting';
import { isSignableMaterialRarity } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const makeSim = (cls = 'warrior', seed = 42) =>
  new Sim({ seed, playerClass: cls as never, autoEquip: false });
const FRESH_CORPSE_TIMER = 60;

const meta = (sim: Sim) =>
  (sim as never as { players: Map<number, never> }).players.get(sim.playerId)! as {
    inventory: InvSlot[];
    bags: (string | null)[];
    copper: number;
    equipment: Record<string, string | undefined>;
  };

// Fill every free slot with distinct throwaway 1-per-slot items so the next
// add has nowhere to go. Uses real gear ids (stackSize 1).
function fillBags(sim: Sim): void {
  const m = meta(sim);
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1);
    i++;
  }
}

describe('stack sizes and stacking math', () => {
  it('gear, bags, and tools never stack; consumables stack to 20', () => {
    expect(stackSizeOf(ITEMS.worn_sword)).toBe(1);
    expect(stackSizeOf(ITEMS.linen_pouch)).toBe(1);
    expect(stackSizeOf(ITEMS.simple_fishing_pole)).toBe(1);
    expect(stackSizeOf(ITEMS.baked_bread)).toBe(20);
    expect(stackSizeOf(ITEMS.minor_healing_potion)).toBe(20);
  });

  it('addStacked tops up existing stacks then splits into fresh ones', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 18 }];
    addStacked(inv, 'baked_bread', 25);
    expect(inv).toEqual([
      { itemId: 'baked_bread', count: 20 },
      { itemId: 'baked_bread', count: 20 },
      { itemId: 'baked_bread', count: 3 },
    ]);
  });

  it('each copy of an unstackable item takes its own slot', () => {
    const inv: InvSlot[] = [];
    addStacked(inv, 'worn_sword', 3);
    expect(inv).toHaveLength(3);
  });

  it('countFit accounts for stack top-up room plus free slots', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 15 }];
    // capacity 2: 5 fit into the existing stack + 20 into the one free slot
    expect(countFit(inv, { general: 2, materials: 0 }, 'baked_bread', 99)).toBe(25);
    expect(canAddItem(inv, { general: 2, materials: 0 }, 'baked_bread', 25)).toBe(true);
    expect(canAddItem(inv, { general: 2, materials: 0 }, 'baked_bread', 26)).toBe(false);
  });

  it('never merges into an instanced slot and offers it no top-up room (#1165)', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 5, instance: { signer: 'Ana' } }];
    // capacity 1: the instanced slot occupies the only slot and cannot absorb more
    expect(countFit(inv, { general: 1, materials: 0 }, 'baked_bread', 1)).toBe(0);
    addStacked(inv, 'baked_bread', 3);
    expect(inv).toEqual([
      { itemId: 'baked_bread', count: 5, instance: { signer: 'Ana' } },
      { itemId: 'baked_bread', count: 3 },
    ]);
  });

  it('an instanced add merges into a byte-equal slot and never into a plain one', () => {
    const inv: InvSlot[] = [
      { itemId: 'baked_bread', count: 5, instance: { signer: 'Ana' } },
      { itemId: 'baked_bread', count: 5 },
    ];
    // Both slots occupied (capacity 2): the byte-equal signed stack is the only
    // top-up room the signed add sees; the plain stack offers it none.
    expect(countFit(inv, { general: 2, materials: 0 }, 'baked_bread', 99, { signer: 'Ana' })).toBe(
      15,
    );
    addStacked(inv, 'baked_bread', 3, { signer: 'Ana' });
    expect(inv).toEqual([
      { itemId: 'baked_bread', count: 8, instance: { signer: 'Ana' } },
      { itemId: 'baked_bread', count: 5 },
    ]);
    // A differently-signed add gets no top-up room from either slot.
    expect(countFit(inv, { general: 2, materials: 0 }, 'baked_bread', 1, { signer: 'Bru' })).toBe(
      0,
    );
  });

  it('the merge stops AT the stack cap: room is exactly stackSize minus count', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 19, instance: { signer: 'Ana' } }];
    expect(countFit(inv, { general: 1, materials: 0 }, 'baked_bread', 99, { signer: 'Ana' })).toBe(
      1,
    );
    addStacked(inv, 'baked_bread', 1, { signer: 'Ana' });
    expect(inv[0].count).toBe(20);
    // At the cap the full stack offers zero room and a fresh add needs a slot.
    expect(countFit(inv, { general: 1, materials: 0 }, 'baked_bread', 1, { signer: 'Ana' })).toBe(
      0,
    );
  });

  it('canGrantItemInstance is all-or-nothing across the whole requested count (#2473)', () => {
    // The signed-grant guard the corpse harvest reads. Its default is one copy,
    // but a multi-unit signed yield must ask about ALL its units: a slot-full
    // bag whose same-signer stack has room for one of three has to refuse, or
    // the other two push a fresh slot past capacity (#2139, the class this
    // guard exists to close).
    const signer = { signer: 'Ana' };
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 19, instance: { signer: 'Ana' } }];
    // Capacity 1: zero free slots, exactly one unit of merge room.
    expect(canGrantItemInstance(inv, { general: 1, materials: 0 }, 'baked_bread', signer)).toBe(
      true,
    );
    expect(canGrantItemInstance(inv, { general: 1, materials: 0 }, 'baked_bread', signer, 1)).toBe(
      true,
    );
    expect(canGrantItemInstance(inv, { general: 1, materials: 0 }, 'baked_bread', signer, 2)).toBe(
      false,
    );
    expect(canGrantItemInstance(inv, { general: 1, materials: 0 }, 'baked_bread', signer, 3)).toBe(
      false,
    );
    // One free slot absorbs a whole fresh stack, so the same counts now pass.
    expect(canGrantItemInstance(inv, { general: 2, materials: 0 }, 'baked_bread', signer, 3)).toBe(
      true,
    );
    // A differently-signed grant sees neither the merge room nor a shortcut.
    expect(
      canGrantItemInstance(inv, { general: 1, materials: 0 }, 'baked_bread', { signer: 'Bru' }, 1),
    ).toBe(false);
  });

  it('a charge-bearing payload gets one unit per fresh slot and never tops up its twin', () => {
    const charged = { signer: 'Ana', charges: { zap: 2 } };
    const inv: InvSlot[] = [
      { itemId: 'baked_bread', count: 1, instance: { ...charged, charges: { zap: 2 } } },
    ];
    // capacity 3: the byte-equal charged slot offers NO room (mergeability),
    // and each of the two free slots absorbs exactly one charged unit.
    expect(countFit(inv, { general: 3, materials: 0 }, 'baked_bread', 99, charged)).toBe(2);
    addStacked(inv, 'baked_bread', 2, charged);
    expect(inv).toHaveLength(3);
    for (const s of inv) expect(s.count).toBe(1);
  });

  it('load cap allows locked counted stacks while charges remain one-per-slot', () => {
    expect(instancedCountCap(ITEMS.wolf_fang, { locked: true })).toBe(20);
    expect(instancedCountCap(ITEMS.wolf_fang, { signer: 'Ana', locked: true })).toBe(20);
    expect(instancedCountCap(ITEMS.wolf_fang, { locked: true, charges: { zap: 2 } })).toBe(1);
    expect(instancedCountCap(undefined, { locked: true })).toBe(Number.POSITIVE_INFINITY);
  });

  it('fresh instanced slots each carry their own deep clone of the payload', () => {
    const payload = { signer: 'Ana', rolled: { stats: { str: 1 } } };
    const inv: InvSlot[] = [];
    // 25 mergeable copies split 20 + 5 across two fresh slots; a shared payload
    // object between them (or with the caller) would alias rolled.stats.
    addStacked(inv, 'baked_bread', 25, payload);
    expect(inv).toHaveLength(2);
    expect(inv[0].instance).toEqual(payload);
    expect(inv[1].instance).toEqual(payload);
    expect(inv[0].instance).not.toBe(inv[1].instance);
    payload.rolled.stats.str = 99;
    expect(inv[0].instance?.rolled?.stats?.str).toBe(1);
    expect(inv[1].instance?.rolled?.stats?.str).toBe(1);
  });

  it('fitsAll simulates the batch cumulatively', () => {
    const inv: InvSlot[] = [];
    expect(
      fitsAll(inv, { general: 2, materials: 0 }, [
        { itemId: 'worn_sword', count: 1 },
        { itemId: 'rusty_dagger', count: 1 },
      ]),
    ).toBe(true);
    expect(
      fitsAll(inv, { general: 2, materials: 0 }, [
        { itemId: 'worn_sword', count: 1 },
        { itemId: 'rusty_dagger', count: 1 },
        { itemId: 'training_mace', count: 1 },
      ]),
    ).toBe(false);
  });
});

describe('capacity budget and the equip/unequip commands', () => {
  it('a fresh character has the 16-slot backpack and 4 empty sockets', () => {
    const sim = makeSim();
    expect(sim.bags).toEqual([null, null, null, null]);
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS);
    expect(BAG_SOCKETS).toBe(4);
  });

  it('equipping a bag from the inventory raises capacity and frees its slot', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(true);
    sim.equipBag('linen_pouch');
    expect(sim.bags[0]).toBe('linen_pouch');
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS + 6);
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(false);
  });

  it('using a bag item equips it (useItem path)', () => {
    const sim = makeSim();
    sim.addItem('travelers_knapsack', 1);
    sim.useItem('travelers_knapsack');
    expect(sim.bags[0]).toBe('travelers_knapsack');
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS + 8);
  });

  it('equipping onto an occupied socket swaps and returns the old bag', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 0);
    sim.addItem('wolfhide_satchel', 1);
    sim.equipBag('wolfhide_satchel', 0);
    expect(sim.bags[0]).toBe('wolfhide_satchel');
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS + 10);
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(true);
  });

  it('a fifth bag with all sockets full is refused with an error', () => {
    const sim = makeSim();
    for (const _ of [0, 1, 2, 3]) sim.addItem('linen_pouch', 1);
    for (const i of [0, 1, 2, 3]) sim.equipBag('linen_pouch', i);
    sim.addItem('wolfhide_satchel', 1);
    sim.drainEvents();
    sim.equipBag('wolfhide_satchel');
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'All your bag slots are full.')).toBe(
      true,
    );
    expect(sim.bags.every((b) => b === 'linen_pouch')).toBe(true);
  });

  it('unequipping a bag is refused while the items would not fit the shrunk budget', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 0);
    fillBags(sim);
    sim.drainEvents();
    sim.unequipBag(0);
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'You have too many items to remove that bag.',
      ),
    ).toBe(true);
    expect(sim.bags[0]).toBe('linen_pouch');
    // free enough room (7 slots: 6 lost capacity + 1 for the bag itself)
    for (let i = 0; i < 7; i++) sim.discardItem(sim.inventory[sim.inventory.length - 1].itemId, 1);
    sim.unequipBag(0);
    expect(sim.bags[0]).toBeNull();
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(true);
  });

  it('unequipping gear is refused when the bags are full', () => {
    const sim = makeSim();
    fillBags(sim);
    sim.drainEvents();
    const ok = sim.unequipItem('chest');
    const ev = sim.drainEvents();
    expect(ok).toBe(false);
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
  });

  it('equipping a payload-bearing copy by id is refused, not stripped (#2837)', () => {
    // meta.bags stores only a bare item id: not reachable through shipped
    // content today, but the copy must be refused rather than silently
    // stripped the moment one ever does carry a payload.
    const sim = makeSim();
    sim.addItemInstance('linen_pouch', { signer: 'Provenance' }, sim.playerId, 1, {
      craftedRecipeId: 'recipe_eastbrook_chain_vest',
    });
    sim.drainEvents();
    sim.equipBag('linen_pouch');
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) =>
          e.type === 'error' &&
          e.text === 'That bag cannot be equipped while it carries a special property.',
      ),
    ).toBe(true);
    expect(sim.bags.every((b) => b === null)).toBe(true);
    const slot = sim.inventory.find((s) => s.itemId === 'linen_pouch');
    expect(slot?.instance?.signer).toBe('Provenance');
    expect(slot?.craftedRecipeId).toBe('recipe_eastbrook_chain_vest');
  });

  it('equipping a payload-bearing copy by named slot index is refused, not stripped (#2837)', () => {
    // The shipped UI/wire path always names a slot index (bags_window.ts,
    // server/game.ts): this is the arm nearly every real equip goes through,
    // distinct from the id-only fallback covered above.
    const sim = makeSim();
    sim.addItemInstance('linen_pouch', { signer: 'Provenance' }, sim.playerId, 1, {
      craftedRecipeId: 'recipe_eastbrook_chain_vest',
    });
    const slotIndex = sim.inventory.findIndex((s) => s.itemId === 'linen_pouch');
    sim.drainEvents();
    sim.equipBag('linen_pouch', undefined, { slotIndex });
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) =>
          e.type === 'error' &&
          e.text === 'That bag cannot be equipped while it carries a special property.',
      ),
    ).toBe(true);
    expect(sim.bags.every((b) => b === null)).toBe(true);
    const slot = sim.inventory.find((s) => s.itemId === 'linen_pouch');
    expect(slot?.instance?.signer).toBe('Provenance');
    expect(slot?.craftedRecipeId).toBe('recipe_eastbrook_chain_vest');
  });

  it('a plain copy still equips by named slot index while another copy of the same id carries a payload', () => {
    const sim = makeSim();
    sim.addItemInstance('linen_pouch', { signer: 'Provenance' }, sim.playerId, 1, {
      craftedRecipeId: 'recipe_eastbrook_chain_vest',
    });
    sim.addItem('linen_pouch', 1);
    const plainIndex = sim.inventory.findIndex(
      (s) => s.itemId === 'linen_pouch' && !s.instance && s.craftedRecipeId === undefined,
    );
    expect(plainIndex).toBeGreaterThanOrEqual(0);
    sim.equipBag('linen_pouch', undefined, { slotIndex: plainIndex });
    expect(sim.bags[0]).toBe('linen_pouch');
    const remaining = sim.inventory.find((s) => s.itemId === 'linen_pouch');
    expect(remaining?.instance?.signer, 'the payload-bearing copy is untouched').toBe('Provenance');
  });
});

describe('bags are declared payload-free (#2837)', () => {
  // equipBag/unequipBag store only a bare item id in meta.bags: there is
  // nowhere to park an instance payload or a craftedRecipeId while a bag is
  // worn. craftedRecipeId is already impossible for a bag (crafting.ts
  // isCraftedDisenchantTrackedOutput and the commission opt-in are both
  // weapon/armor/held_offhand-only, checked below), and the signer mint is
  // bag-exempt at the source: mintsSignedCraftOutput (crafting.ts) refuses
  // to sign a bag-kind output at ANY rarity, so the phase 05 tailoring
  // ladder's rare/epic craftable bags grant plain and fungible (loot-only
  // bags always did: gravewoven_bag and mistcallers_duffel, both recipe-free
  // dungeon drops granted plain). This pins the mint-side half of the
  // equip-time guard (bags.ts equipBag, which still refuses a
  // payload-carrying copy as defense in depth): the day the exemption is
  // dropped or bypassed, this fails at test time instead of the first
  // player equip refusing a freshly crafted bag.
  it('a craftable bag never mints a signed crafted copy, at any authored rarity', () => {
    const bagRecipes = ALL_RECIPES.filter((r) => ITEMS[r.resultItemId]?.kind === 'bag');
    expect(bagRecipes.length, 'sanity: there is a bag recipe to check').toBeGreaterThan(0);
    // The authored catalog really exercises the bag exemption: the phase 05
    // tailoring ladder ships rare/epic craftable bags, so this pin is
    // decisive, not vacuously green over an all-sub-rare catalog.
    expect(
      bagRecipes.some((r) => {
        const def = ITEMS[r.resultItemId];
        const q = def?.quality === undefined || def.quality === 'poor' ? 'common' : def.quality;
        return isSignableMaterialRarity(q);
      }),
      'sanity: at least one bag recipe sits at a signable rarity',
    ).toBe(true);
    for (const recipe of bagRecipes) {
      expect(
        mintsSignedCraftOutput(ITEMS[recipe.resultItemId]),
        `${recipe.id} -> ${recipe.resultItemId}: a crafted bag must grant plain and payload-free`,
      ).toBe(false);
    }
    // Bag-scoped, not a blanket off-switch: a rare non-bag def still mints.
    const rareNonBag = Object.values(ITEMS).find((d) => d.kind !== 'bag' && d.quality === 'rare');
    expect(rareNonBag, 'sanity: a rare non-bag def exists').toBeTruthy();
    expect(mintsSignedCraftOutput(rareNonBag)).toBe(true);
  });

  it('bags are never a commission-eligible kind', () => {
    expect(isCommissionEligibleKind('bag')).toBe(false);
  });
});

describe('capacity gates at the grant boundaries', () => {
  it('vendor buy is refused (and not charged) when the bags are full', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 100000;
    fillBags(sim);
    // find the vendor npc and stand next to it
    const wilkes = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.vendorItems.includes('linen_pouch'),
    )!;
    sim.player.pos.x = wilkes.pos.x;
    sim.player.pos.z = wilkes.pos.z;
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.buyItem(wilkes.id, 'linen_pouch');
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(m.copper).toBe(copperBefore);
    expect(sim.countItem('linen_pouch')).toBe(0);
  });

  it('walk-by autoloot stays silent when the bags are full (no toast loop)', () => {
    const sim = makeSim();
    fillBags(sim);
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    wolf.hp = 0;
    wolf.dead = true;
    wolf.corpseTimer = FRESH_CORPSE_TIMER;
    wolf.lootable = true;
    wolf.tappedById = sim.playerId;
    wolf.loot = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] };
    wolf.pos = { ...sim.player.pos };
    sim.drainEvents();
    sim.autoLoot(wolf.id);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error')).toBe(false); // passive pass: no toast
    expect(wolf.loot!.items[0].count).toBe(1); // item left on the corpse
    // the deliberate click still gets exactly one toast
    sim.lootCorpse(wolf.id);
    const ev2 = sim.drainEvents();
    expect(ev2.filter((e) => e.type === 'error' && e.text === 'Your bags are full.')).toHaveLength(
      1,
    );
  });

  it('addItem never destroys an async grant even above capacity (force path)', () => {
    const sim = makeSim();
    fillBags(sim);
    const used = sim.inventory.length;
    sim.addItem('wolf_fang', 1); // e.g. a need-greed win landing later
    expect(sim.inventory.length).toBe(used + 1);
    expect(sim.countItem('wolf_fang')).toBe(1);
  });

  it('corpse loot that does not fit stays on the corpse', () => {
    const sim = makeSim();
    fillBags(sim);
    // hand-build a lootable corpse next to the player
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    wolf.hp = 0;
    wolf.dead = true;
    wolf.corpseTimer = FRESH_CORPSE_TIMER;
    wolf.lootable = true;
    wolf.tappedById = sim.playerId;
    wolf.loot = { copper: 0, items: [{ itemId: 'wolf_fang', count: 2 }] };
    wolf.pos = { ...sim.player.pos };
    sim.drainEvents();
    sim.lootCorpse(wolf.id);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(wolf.loot!.items[0].count).toBe(2); // untouched, still on the corpse
    expect(sim.countItem('wolf_fang')).toBe(0);
    // free one slot: exactly one fang fits... a 20-stack slot takes both
    sim.discardItem(sim.inventory[sim.inventory.length - 1].itemId, 1);
    sim.lootCorpse(wolf.id);
    expect(sim.countItem('wolf_fang')).toBe(2);
  });
});

describe('persistence and back-compat', () => {
  it('serializeCharacter round-trips the equipped bags', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 2);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.bags).toEqual([null, null, 'linen_pouch', null]);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    expect(sim2.bags).toEqual([null, null, 'linen_pouch', null]);
    expect(sim2.bagCapacity).toBe(BACKPACK_SLOTS + 6);
    expect(pid).toBeGreaterThan(0);
  });

  it('a pre-bag save (no bags field) loads with 4 empty sockets', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    delete (state as { bags?: unknown }).bags;
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    sim2.addPlayer('warrior', 'Legacy', { state });
    expect(sim2.bags).toEqual([null, null, null, null]);
    expect(sim2.bagCapacity).toBe(BACKPACK_SLOTS);
  });

  it('a tampered save with a non-bag id in a socket loads it as empty', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = ['worn_sword', 'not_an_item', 'linen_pouch', null];
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    sim2.addPlayer('warrior', 'Tampered', { state });
    expect(sim2.bags).toEqual([null, null, 'linen_pouch', null]);
  });

  it('an over-capacity legacy inventory is preserved and blocks new pickups only', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = [null, null, null, null];
    state.inventory = Array.from({ length: 20 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Hoarder', { state });
    const m2 = (sim2 as never as { players: Map<number, { inventory: InvSlot[] }> }).players.get(
      pid,
    )!;
    expect(m2.inventory).toHaveLength(20); // nothing destroyed
    expect(sim2.canAddItem('wolf_fang', 1, pid)).toBe(false);
  });
});

describe('pre-bag save migration (equivalent bags for earned space)', () => {
  it('the frozen ladder mirrors the LIVE slot counts of the bags it names', () => {
    // The ladder is a frozen back-compat subset (new bags never join it), but
    // its hard-coded slot numbers must track the content table: a re-tuned
    // bagSlots with a stale ladder row would compute coverage from the wrong
    // number and under-grant a pre-bag save with every other test green.
    for (const b of MIGRATION_BAGS) {
      expect(ITEMS[b.id]?.bagSlots, b.id).toBe(b.slots);
      // The intent is "not a materials-only bag", not "the field is absent":
      // an explicit `materialsOnly: false` on a ladder row is still a general
      // bag and must not red this arm.
      expect(isMaterialsOnlyBag(ITEMS[b.id]), b.id).toBe(false);
    }
  });

  it('grants nothing at or under the backpack budget', () => {
    expect(migrationBagsFor(0)).toEqual([]);
    expect(migrationBagsFor(BACKPACK_SLOTS)).toEqual([]);
  });

  it('covers small overflows with the lowest quality tier that suffices', () => {
    expect(migrationBagsFor(20)).toEqual(['linen_pouch']); // needs 4
    expect(migrationBagsFor(24)).toEqual(['travelers_knapsack']); // needs 8
    // needs 14: two commons, never a free epic duffel
    expect(migrationBagsFor(30)).toEqual(['travelers_knapsack', 'linen_pouch']);
    expect(migrationBagsFor(30).length).toBeLessThanOrEqual(BAG_SOCKETS);
  });

  it('escalates tiers only when a lower tier cannot cover the need', () => {
    // needs 44: commons max out at 32 and uncommons at 40, so rare tier
    expect(migrationBagsFor(60)).toEqual([
      'gravewoven_bag',
      'gravewoven_bag',
      'gravewoven_bag',
      'travelers_knapsack',
    ]);
    // needs 56: exactly four epics (the 72-slot ceiling)
    expect(migrationBagsFor(72)).toEqual([
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
    ]);
    // exact tier boundary: used 48 is needed 32 = 4x8, the strict < must KEEP
    // the common tier (a <= would silently escalate to uncommon)
    expect(migrationBagsFor(48)).toEqual([
      'travelers_knapsack',
      'travelers_knapsack',
      'travelers_knapsack',
      'travelers_knapsack',
    ]);
    // first slot past the 72 ceiling: four epics, 1 slot of tolerated overflow
    expect(migrationBagsFor(73)).toEqual([
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
    ]);
    // past the ceiling: still four epics, the rest stays tolerated overflow
    expect(migrationBagsFor(90)).toHaveLength(4);
  });

  it('equips migration bags on loading a pre-bag save and covers the used space', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    delete (state as { bags?: unknown }).bags;
    state.inventory = Array.from({ length: 30 }, (_, i) => ({
      itemId: i % 2 ? 'worn_sword' : 'rusty_dagger',
      count: 1,
    }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Veteran', { state });
    const m2 = (sim2 as never as { players: Map<number, { bags: (string | null)[] }> }).players.get(
      pid,
    )!;
    expect(m2.bags).toEqual(['travelers_knapsack', 'linen_pouch', null, null]);
    // exact coverage: everything owned fits (30/30), nothing was lost
    expect(bagCapacity(m2.bags)).toBeGreaterThanOrEqual(30);
    sim2.discardItem('worn_sword', 1, pid);
    expect(sim2.canAddItem('wolf_fang', 1, pid)).toBe(true); // freeing one slot re-opens pickups
    const ev = sim2.tick();
    expect(
      ev.some(
        (e) => e.type === 'log' && e.text === 'Your belongings have been packed into new bags.',
      ),
    ).toBe(true);
  });

  it('is idempotent: the migrated save round-trips without a second grant', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    delete (state as { bags?: unknown }).bags;
    state.inventory = Array.from({ length: 20 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Veteran', { state });
    const migrated = sim2.serializeCharacter(pid)!;
    expect(migrated.bags).toEqual(['linen_pouch', null, null, null]);
    // discard down to an empty backpack-sized load, then unequip the granted bag
    const sim3 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid3 = sim3.addPlayer('warrior', 'Veteran', { state: migrated });
    const m3 = (sim3 as never as { players: Map<number, { bags: (string | null)[] }> }).players.get(
      pid3,
    )!;
    expect(m3.bags).toEqual(['linen_pouch', null, null, null]); // loaded, not re-granted
    const ev = sim3.tick();
    expect(ev.some((e) => e.type === 'log' && /packed into new bags/.test(e.text))).toBe(false);
  });

  it('does not grant on a post-bag save even if it is over capacity (tampered)', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = [null, null, null, null];
    state.inventory = Array.from({ length: 30 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Tamper', { state });
    const m2 = (sim2 as never as { players: Map<number, { bags: (string | null)[] }> }).players.get(
      pid,
    )!;
    expect(m2.bags).toEqual([null, null, null, null]);
    expect(sim2.canAddItem('wolf_fang', 1, pid)).toBe(false); // overflow just blocks pickups
  });
});

describe('consumeOneScratch (#2350)', () => {
  // A real weapon (unstackable, enchantable) so instanced/enchant fixtures match
  // how gear actually carries a payload, and a real stackable junk id for the
  // plain-stack cases. consumeOneScratch itself keys only on itemId and instance
  // shape (no ITEMS lookup), so the ids are chosen for realism, not behavior.
  const GEAR = 'eastbrook_arming_sword';
  const STACK = 'spider_leg';

  // Victim-order pins: the pure three-pass walk over an InvSlot[], no Sim.
  // Pass 1 = highest-index plain slot; pass 2 = highest-index instanced slot the
  // exclude predicate does not match; pass 3 = highest-index instanced slot
  // (the excluded ones), the fallback when no preferred copy is left.

  it('prefers a plain slot over an instanced one even at a lower index', () => {
    const scratch: InvSlot[] = [
      { itemId: GEAR, count: 1 }, // plain, index 0
      { itemId: GEAR, count: 1, instance: { signer: 'A' } }, // instanced, higher index
    ];
    const payload = consumeOneScratch(scratch, GEAR);
    expect(payload).toBeUndefined(); // a plain victim carries no payload
    expect(scratch).toEqual([{ itemId: GEAR, count: 1, instance: { signer: 'A' } }]);
  });

  it('among plain slots consumes the highest index (the count drop proves which)', () => {
    const scratch: InvSlot[] = [
      { itemId: STACK, count: 3 },
      { itemId: STACK, count: 3 },
    ];
    consumeOneScratch(scratch, STACK);
    expect(scratch[0].count).toBe(3); // lower index untouched
    expect(scratch[1].count).toBe(2); // highest index took the unit
  });

  it('prefers an unexcluded instanced slot over an excluded one at a higher index', () => {
    const scratch: InvSlot[] = [
      { itemId: GEAR, count: 1, instance: { signer: 'A' } }, // unexcluded, index 0
      { itemId: GEAR, count: 1, instance: { enchant: 'enchant_weapon_might' } }, // excluded, index 1
    ];
    const payload = consumeOneScratch(scratch, GEAR, (p) => p.enchant !== undefined);
    expect(payload).toEqual({ signer: 'A' }); // the unexcluded copy is the victim
    expect(scratch).toEqual([
      { itemId: GEAR, count: 1, instance: { enchant: 'enchant_weapon_might' } },
    ]);
  });

  it('falls back to the highest-index excluded slot when only excluded copies remain (pass 3)', () => {
    const scratch: InvSlot[] = [
      { itemId: GEAR, count: 1, instance: { enchant: 'enchant_weapon_might' } },
      { itemId: GEAR, count: 1, instance: { enchant: 'enchant_weapon_agility' } },
    ];
    const payload = consumeOneScratch(scratch, GEAR, (p) => p.enchant !== undefined);
    expect(payload).toEqual({ enchant: 'enchant_weapon_agility' }); // highest-index excluded
    expect(scratch).toEqual([
      { itemId: GEAR, count: 1, instance: { enchant: 'enchant_weapon_might' } },
    ]);
  });

  it('splices a count-1 victim out and decrements a higher-count victim in place', () => {
    const single: InvSlot[] = [{ itemId: GEAR, count: 1 }];
    consumeOneScratch(single, GEAR);
    expect(single).toHaveLength(0); // the emptied slot is removed

    const triple: InvSlot[] = [{ itemId: STACK, count: 3 }];
    consumeOneScratch(triple, STACK);
    expect(triple).toEqual([{ itemId: STACK, count: 2 }]); // decremented, slot stays
  });

  it('returns the victim payload by reference, and undefined for a plain or absent victim', () => {
    const inst = { signer: 'A' };
    const instanced: InvSlot[] = [{ itemId: STACK, count: 2, instance: inst }];
    expect(consumeOneScratch(instanced, STACK)).toBe(inst); // the SAME object, not a clone

    const plain: InvSlot[] = [{ itemId: STACK, count: 2 }];
    expect(consumeOneScratch(plain, STACK)).toBeUndefined();

    const untouched: InvSlot[] = [{ itemId: GEAR, count: 1 }];
    const before = untouched.map((s) => ({ ...s }));
    expect(consumeOneScratch(untouched, STACK)).toBeUndefined(); // no slot matches STACK
    expect(untouched).toEqual(before); // and the scratch is left untouched
  });

  // Mirror-vs-real drift pins (the #2139 class): consumeOneScratch run on a deep
  // copy must land the exact inventory the live remover it models produces, or a
  // capacity pre-check would disagree with the actual consumption.
  const shape = (inv: InvSlot[]) =>
    inv.map((s) => ({ itemId: s.itemId, count: s.count, instance: s.instance }));

  it('mirrors removePreferFungible: the salvage path consumes the plain copy first', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const pmeta = sim.ctx.resolve(pid)!.meta;
    const fixture: InvSlot[] = [
      { itemId: GEAR, count: 1 }, // plain fungible copy
      { itemId: GEAR, count: 1, instance: { signer: 'X' } }, // unenchanted instanced
      {
        itemId: GEAR,
        count: 1,
        instance: { enchant: 'enchant_weapon_might', rolled: { stats: { str: 2 } } },
      }, // enchanted instanced
      { itemId: STACK, count: 5 }, // unrelated filler
    ];
    const copy = structuredClone(fixture);
    pmeta.inventory = fixture;

    removePreferFungible(sim.ctx, GEAR, 1, pid); // the live salvage remover (no exclusion)
    consumeOneScratch(copy, GEAR);

    expect(shape(pmeta.inventory)).toEqual(shape(copy));
  });

  it('mirrors removeEnchantableItem: apply-enchant takes the unenchanted instanced copy (pass 2)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const pmeta = sim.ctx.resolve(pid)!.meta;
    // No plain copy, so removeEnchantableItem's fungible pass finds nothing and
    // its instanced pass fires: consumeOneScratch's pass 2 must match it.
    const fixture: InvSlot[] = [
      { itemId: GEAR, count: 1, instance: { signer: 'X' } }, // unenchanted instanced
      {
        itemId: GEAR,
        count: 1,
        instance: { enchant: 'enchant_weapon_might', rolled: { stats: { str: 2 } } },
      }, // enchanted instanced, excluded from the pass
      { itemId: STACK, count: 5 },
    ];
    const copy = structuredClone(fixture);
    pmeta.inventory = fixture;

    sim.removeEnchantableItem(GEAR, 1, pid);
    consumeOneScratch(copy, GEAR, isEnchantedInstance);

    expect(shape(pmeta.inventory)).toEqual(shape(copy));
  });

  it('mirrors the disenchant fallback removeItem when every copy is enchanted (pass 3)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const pmeta = sim.ctx.resolve(pid)!.meta;
    // Every copy of GEAR is enchanted-instanced, so countEnchantableItem is 0 and
    // resolveDisenchant falls back to the plain removeItem walk (highest index).
    const fixture: InvSlot[] = [
      {
        itemId: GEAR,
        count: 1,
        instance: { enchant: 'enchant_weapon_might', rolled: { stats: { str: 2 } } },
      },
      {
        itemId: GEAR,
        count: 1,
        instance: { enchant: 'enchant_weapon_might', rolled: { stats: { str: 3 } } },
      },
      { itemId: STACK, count: 5 },
    ];
    const copy = structuredClone(fixture);
    pmeta.inventory = fixture;

    sim.ctx.removeItem(GEAR, 1, pid);
    consumeOneScratch(copy, GEAR, isEnchantedInstance);

    expect(shape(pmeta.inventory)).toEqual(shape(copy));
  });
});

// ---------------------------------------------------------------------------
// Phase 05: the fit gates above take a two-pool PoolCapacity split, not a flat
// capacity number. The pure pool arithmetic is pinned in tests/bag_pools.test.ts
// with a synthetic predicate; this block drives the SAME rule through the real
// exported gates with the REAL derived taxonomy, so a gate that forgot to wire
// isMaterialItemId (or wired an item-kind approximation instead) fails here.
describe('two-pool capacity through the real gates and the real taxonomy', () => {
  // Real members of the derived material set, classified below rather than
  // assumed, plus real non-materials. Both materials stack to 20 (junk kind).
  const MATERIAL = 'linen_scrap';
  const MATERIAL_2 = 'copper_ore';
  const FOOD = 'baked_bread'; // kind 'food': a non-material that stacks to 20
  const GEAR = 'worn_sword'; // kind 'weapon': a non-material that never stacks

  it('the fixture ids really are (and are not) materials', () => {
    // Without this the whole block could be exercising the non-material arm
    // twice and still be green.
    expect(MATERIAL_ITEM_IDS.has(MATERIAL)).toBe(true);
    expect(MATERIAL_ITEM_IDS.has(MATERIAL_2)).toBe(true);
    expect(MATERIAL_ITEM_IDS.has(FOOD)).toBe(false);
    expect(MATERIAL_ITEM_IDS.has(GEAR)).toBe(false);
    expect(stackSizeOf(ITEMS[MATERIAL])).toBe(20);
    expect(stackSizeOf(ITEMS[GEAR])).toBe(1);
  });

  it('countFit refuses a NON-material once general is full, materials headroom or not', () => {
    const pools: PoolCapacity = { general: 3, materials: 5 };
    const inv: InvSlot[] = Array.from({ length: 3 }, () => ({ itemId: GEAR, count: 1 }));
    // Five materials slots stand free and buy the food nothing: a non-material
    // may only ever take general-pool headroom.
    expect(countFit(inv, pools, FOOD, 10)).toBe(0);
    // One slot back below the boundary and a whole fresh stack fits again.
    expect(countFit(inv.slice(0, 2), pools, FOOD, 10)).toBe(10);
  });

  it('countFit lets a MATERIAL spend the materials pool while general is full', () => {
    const pools: PoolCapacity = { general: 3, materials: 5 };
    const inv: InvSlot[] = Array.from({ length: 3 }, () => ({ itemId: GEAR, count: 1 }));
    // Five free materials slots at a 20 stack: 100 units, and not one more.
    expect(countFit(inv, pools, MATERIAL, 999)).toBe(100);
    expect(canAddItem(inv, pools, MATERIAL, 100)).toBe(true);
    expect(canAddItem(inv, pools, MATERIAL, 101)).toBe(false);
  });

  it('topping up an existing material stack is POOL-BLIND, but a fresh stack is not', () => {
    // Both pools exactly full, and the one material stack has room for 5 more.
    // Top-up needs no slot, so 5 of the 8 requested units land; the other 3
    // would need a fresh stack and there is no slot in either pool for it.
    const pools: PoolCapacity = { general: 2, materials: 1 };
    const inv: InvSlot[] = [
      { itemId: MATERIAL, count: 15 },
      { itemId: GEAR, count: 1 },
      { itemId: GEAR, count: 1 },
    ];
    expect(countFit(inv, pools, MATERIAL, 8)).toBe(5);
    // A DIFFERENT material has no stack to top up, so it gets nothing at all.
    expect(countFit(inv, pools, MATERIAL_2, 1)).toBe(0);
  });

  it('canGrantCopies applies the split, all-or-nothing, exactly at the boundary', () => {
    const pools: PoolCapacity = { general: 0, materials: 2 };
    expect(canGrantCopies([], pools, MATERIAL, 40)).toBe(true);
    expect(canGrantCopies([], pools, MATERIAL, 41)).toBe(false);
    // The non-material twin gets nothing from a general pool of zero.
    expect(canGrantCopies([], pools, FOOD, 1)).toBe(false);
  });

  it('canGrantItemInstance reads the two-pool split at any count', () => {
    const pools: PoolCapacity = { general: 0, materials: 1 };
    const signed = { signer: 'Ana' };
    // One materials slot, a mergeable payload: exactly one 20-unit stack, so
    // 20 fits and 21 does not (the exact-fit boundary the retired
    // fitForItemInstance helper used to surface as a number).
    expect(canGrantItemInstance([], pools, MATERIAL, signed, 20)).toBe(true);
    expect(canGrantItemInstance([], pools, MATERIAL, signed, 21)).toBe(false);
    // A signed NON-material cannot reach the materials pool for even one copy.
    expect(canGrantItemInstance([], pools, FOOD, signed, 1)).toBe(false);
  });

  it('fitsAll admits a mixed batch the materials pool makes room for', () => {
    // general 1 + materials 2: three slots of total headroom, but only ONE of
    // them is reachable by a non-material.
    const pools: PoolCapacity = { general: 1, materials: 2 };
    const mixed: InvSlot[] = [
      { itemId: MATERIAL, count: 1 },
      { itemId: MATERIAL_2, count: 1 },
      { itemId: GEAR, count: 1 },
    ];
    expect(fitsAll([], pools, mixed)).toBe(true);
    // Packing is recomputed from the whole scratch list at every step, never
    // sticky, so the reverse batch order answers the same.
    expect(fitsAll([], pools, [...mixed].reverse())).toBe(true);
    // The discriminating negative: the same three slots of total headroom
    // refuse a batch of just TWO non-materials.
    expect(
      fitsAll([], pools, [
        { itemId: GEAR, count: 1 },
        { itemId: 'rusty_dagger', count: 1 },
      ]),
    ).toBe(false);
  });

  it('freeBagSlotsFor answers the fresh-slot count per kind', () => {
    // The conservative one-slot-per-unit read (trade.ts fitsAfterSwap's unknown
    // stock fallback) must see the same split the stacking gates do.
    const pools: PoolCapacity = { general: 1, materials: 2 };
    expect(freeBagSlotsFor([], pools, MATERIAL)).toBe(3);
    expect(freeBagSlotsFor([], pools, FOOD)).toBe(1);
    expect(freeBagSlotsFor([{ itemId: GEAR, count: 1 }], pools, FOOD)).toBe(0);
  });

  // The mail-take contract (src/sim/mail/post_office.ts mailTake), pinned here
  // at the gate: mailTake asks canGrantCopies per attached stack with
  // bagPools(meta.bags), and a stack that is refused stays ATTACHED to the
  // letter (never destroyed, never force-added). tests/mail.test.ts drives the
  // same pair end to end through a real Sim and a shipped materials satchel;
  // these arms isolate the decision to the gate, so a mail-side harness change
  // cannot quietly stop exercising it. The recipient state is the mail suite's
  // own full-bags fixture (16 food stacks filling general) plus a materials pool.
  const MAIL_FIXTURE: InvSlot[] = Array.from({ length: 16 }, () => ({
    itemId: 'roasted_boar',
    count: 20,
  }));

  it('mail-take: a NON-material parcel is refused (stays attached) when general is full', () => {
    // Five free materials slots and the food parcel still cannot land: the
    // letter keeps it and the recipient is told to make room.
    const pools: PoolCapacity = { general: 16, materials: 5 };
    expect(MATERIAL_ITEM_IDS.has('roasted_boar')).toBe(false);
    expect(canGrantCopies(MAIL_FIXTURE, pools, 'roasted_boar', 2)).toBe(false);
    // The same parcel against one freed general slot does land, so the refusal
    // above is the pool boundary and not a broken fixture.
    expect(canGrantCopies(MAIL_FIXTURE.slice(0, 15), pools, 'roasted_boar', 2)).toBe(true);
  });

  it('mail-take: a MATERIAL parcel IS delivered into materials headroom, same state', () => {
    // The discriminating pair with the arm above: identical recipient, identical
    // pools, and only the parcel's classification differs.
    const pools: PoolCapacity = { general: 16, materials: 5 };
    expect(canGrantCopies(MAIL_FIXTURE, pools, MATERIAL, 2)).toBe(true);
    expect(canGrantCopies(MAIL_FIXTURE, pools, MATERIAL, 100)).toBe(true); // 5 slots x 20
    expect(canGrantCopies(MAIL_FIXTURE, pools, MATERIAL, 101)).toBe(false); // and not one more
    // A recipient with NO satchel equipped (a materials pool of 0) refuses the
    // SAME material parcel exactly like the food one: the delivery above is
    // the satchel's doing, not the taxonomy's. That is the arm
    // tests/mail.test.ts drives end to end through a real Sim.
    expect(canGrantCopies(MAIL_FIXTURE, { general: 16, materials: 0 }, MATERIAL, 2)).toBe(false);
  });

  it('an inventory LONGER than both pools answers 0 for both kinds and never throws', () => {
    // The tolerated-overflow load (a pre-bag save, an unequipped materials bag):
    // 10 slots against a 5-slot budget. Every material stack is at its 20 cap
    // and gear never stacks, so no top-up room masks the refusal.
    const pools: PoolCapacity = { general: 2, materials: 3 };
    const inv: InvSlot[] = [
      ...Array.from({ length: 6 }, () => ({ itemId: MATERIAL, count: 20 })),
      ...Array.from({ length: 4 }, () => ({ itemId: GEAR, count: 1 })),
    ];
    expect(() => countFit(inv, pools, MATERIAL, 1)).not.toThrow();
    expect(countFit(inv, pools, MATERIAL, 1)).toBe(0);
    expect(countFit(inv, pools, GEAR, 1)).toBe(0);
    expect(canAddItem(inv, pools, MATERIAL, 1)).toBe(false);
    expect(canAddItem(inv, pools, GEAR, 1)).toBe(false);
    // Nothing is repaired, migrated, or destroyed by asking.
    expect(inv).toHaveLength(10);
    expect(inv.every((s) => s.count === (s.itemId === MATERIAL ? 20 : 1))).toBe(true);
  });

  it('the sim-side lazy material set IS the UI-side eager set, and both are the ruled 56', () => {
    // Equality alone proves nothing (both delegate to the one derivation in
    // material_derivation.ts), so it is pinned alongside the literal count
    // tests/material_taxonomy.test.ts pins by exact-set equality, plus known
    // members and known NON-members on each side.
    const lazy = materialItemIds();
    expect(lazy.size).toBe(56);
    expect(MATERIAL_ITEM_IDS.size).toBe(56);
    expect(lazy.size).toBe(MATERIAL_ITEM_IDS.size);
    for (const id of lazy) expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    for (const id of MATERIAL_ITEM_IDS) expect(lazy.has(id), id).toBe(true);
    // The exact members this block's gate arms depend on...
    expect(lazy.has(MATERIAL)).toBe(true);
    expect(lazy.has(MATERIAL_2)).toBe(true);
    // ...and non-members from both exclusion classes: a weapon (excluded by
    // kind) and a rare-mob charm (non-poor junk the taxonomy settlement ruled
    // OUT by name). A set that had drifted to "every junk item" would fail here
    // while the size and equality arms above still passed.
    expect(lazy.has(GEAR)).toBe(false);
    expect(lazy.has('gleamstag_charm')).toBe(false);
    expect(ITEMS.gleamstag_charm?.kind).toBe('junk'); // the exclusion is real, not a typo
  });

  it('is deterministic: frozen inputs and same-seed Sims answer identically (no rng drawn)', () => {
    // The pool math draws NO rng (bag_pools.ts states it), so the same inputs
    // must answer the same every call and in every world on a seed.
    const pools: PoolCapacity = Object.freeze({ general: 4, materials: 3 });
    const inv: readonly InvSlot[] = Object.freeze([
      Object.freeze({ itemId: MATERIAL, count: 20 }),
      Object.freeze({ itemId: GEAR, count: 1 }),
    ]) as readonly InvSlot[];
    const first = countFit(inv, pools, MATERIAL, 999);
    expect(countFit(inv, pools, MATERIAL, 999)).toBe(first);
    expect(first).toBe(100); // 2 materials + 3 general free slots, 20 per stack

    const answers = [0, 1].map(() => {
      const sim = makeSim('warrior', 4242);
      const m = meta(sim);
      m.inventory.length = 0; // a known start, so the pins below are literals
      sim.addItem('linen_pouch', 1);
      sim.equipBag('linen_pouch', 0);
      const p = bagPools(m.bags);
      return { pools: p, used: m.inventory.length, fit: countFit(m.inventory, p, MATERIAL, 9999) };
    });
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual({
      pools: { general: BACKPACK_SLOTS + 6, materials: 0 },
      used: 0,
      fit: (BACKPACK_SLOTS + 6) * 20,
    });
  });

  it('bagPools and bagCapacity: the sum and the split agree in general, DIVERGE on a satchel', () => {
    // The equip/unequip shrink guards read the TOTAL while the fit gates read
    // the SPLIT. For unrestricted bags the two agree; the shipped satchels are
    // where they diverge, and this arm documents which of the two numbers
    // each caller wanted.
    expect(bagPools([null, null, null, null])).toEqual({
      general: BACKPACK_SLOTS,
      materials: 0,
    });
    expect(bagPools(['linen_pouch', 'travelers_knapsack', null, null])).toEqual({
      general: BACKPACK_SLOTS + 14,
      materials: 0,
    });
    expect(bagCapacity(['linen_pouch', 'travelers_knapsack', null, null])).toBe(
      BACKPACK_SLOTS + 14,
    );
    // The divergence: a materials satchel raises the TOTAL without raising the
    // general pool, which is the whole two-pool mechanic in two assertions.
    expect(bagPools(['foragers_haversack', null, null, null])).toEqual({
      general: BACKPACK_SLOTS,
      materials: 12,
    });
    expect(bagCapacity(['foragers_haversack', null, null, null])).toBe(BACKPACK_SLOTS + 12);
  });

  it('end to end on shipped content: a real materials satchel opens the second pool', () => {
    // The whole mechanic through the real Sim command path, no pools literals:
    // equip a shipped materialsOnly bag, fill the general pool, and the two
    // kinds diverge exactly as the rule says.
    const sim = makeSim();
    const m = meta(sim);
    expect(ITEMS.foragers_haversack.materialsOnly).toBe(true);
    expect(ITEMS.foragers_haversack.bagSlots).toBe(12);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    expect(m.bags[0]).toBe('foragers_haversack');
    // The backpack alone is the general pool; the satchel's 12 slots are the
    // materials pool, and the total readout is both summed.
    expect(bagPools(m.bags)).toEqual({ general: BACKPACK_SLOTS, materials: 12 });
    expect(bagCapacity(m.bags)).toBe(BACKPACK_SLOTS + 12);

    m.inventory = Array.from({ length: BACKPACK_SLOTS }, () => ({ itemId: GEAR, count: 1 }));
    // General is exactly full: a material pickup still fits, a non-material does not.
    expect(sim.canAddItem(MATERIAL, 1)).toBe(true);
    expect(sim.canAddItem(FOOD, 1)).toBe(false);
    expect(freeBagSlotsFor(m.inventory, bagPools(m.bags), MATERIAL)).toBe(12);
    expect(freeBagSlotsFor(m.inventory, bagPools(m.bags), FOOD)).toBe(0);

    // Fill the materials pool too and the material is refused in turn: the
    // satchel is extra room, never unlimited room.
    m.inventory.push(...Array.from({ length: 12 }, () => ({ itemId: MATERIAL, count: 20 })));
    expect(sim.canAddItem(MATERIAL, 1)).toBe(false);
    expect(sim.canAddItem(FOOD, 1)).toBe(false);
  });

  it('unequipping a materials satchel is refused when the carried load would not fit', () => {
    // The shrink guard on the arm where it is sound: dropping the satchel would
    // leave 28 slots of goods against the bare 16-slot backpack, so it refuses
    // and nothing is force-dropped.
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    m.inventory = [
      ...Array.from({ length: BACKPACK_SLOTS }, () => ({ itemId: GEAR, count: 1 })),
      ...Array.from({ length: 12 }, () => ({ itemId: MATERIAL, count: 20 })),
    ];
    sim.drainEvents();
    sim.unequipBag(0);
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'You have too many items to remove that bag.',
      ),
    ).toBe(true);
    expect(m.bags[0]).toBe('foragers_haversack'); // still equipped
    expect(m.inventory).toHaveLength(BACKPACK_SLOTS + 12); // nothing dropped
  });

  it('unequipping a materials satchel that fits in TOTAL may leave general over capacity, tolerated', () => {
    // PHASE 05 RULING (recorded in state.md; the phase file's over-capacity
    // list mandates this exact arm): the shrink guards compare the TOTAL, so
    // an unequip whose load still fits the summed budget succeeds even when
    // the general pool ends over its own budget. The overflow is tolerated
    // exactly like a legacy over-capacity load: new adds of the crowded class
    // are refused, nothing is destroyed, and re-equipping recovers the state.
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    sim.addItem('burlap_reagent_pouch', 1);
    sim.equipBag('burlap_reagent_pouch', 1);
    expect(bagPools(m.bags)).toEqual({ general: BACKPACK_SLOTS, materials: 20 });
    m.inventory = [
      ...Array.from({ length: BACKPACK_SLOTS }, () => ({ itemId: GEAR, count: 1 })),
      ...Array.from({ length: 6 }, () => ({ itemId: MATERIAL, count: 20 })),
    ];
    sim.drainEvents();
    // 22 slots + the returned pouch = 23 against a new total of 28: allowed.
    sim.unequipBag(1);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error')).toBe(false);
    expect(m.bags[1]).toBe(null);
    expect(m.inventory).toHaveLength(23); // the pouch came back; nothing lost
    // General now holds 17 non-materials against 16: over capacity, tolerated.
    expect(bagPools(m.bags)).toEqual({ general: BACKPACK_SLOTS, materials: 12 });
    expect(sim.canAddItem(GEAR, 1)).toBe(false);
    // The remaining satchel still has materials headroom (6 of 12 used).
    expect(sim.canAddItem(MATERIAL, 1)).toBe(true);
  });

  it('the tolerated-overflow state still grants materials headroom, so total occupancy may pass the summed budget', () => {
    // One step past the ruling arms around this one (the architecture-review
    // finding): with general over budget (17 non-materials against 16), the
    // free materials pool is STILL handed to materials, so consuming it takes
    // total occupancy past bagCapacity. That is the documented exception in
    // the bag_pools.ts header, not a violation: nothing is lost, both kinds
    // are refused once the headroom is spent, and the used/total readout may
    // legitimately read past its denominator in this state.
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    m.inventory = Array.from({ length: 17 }, () => ({ itemId: GEAR, count: 1 }));
    expect(bagCapacity(m.bags)).toBe(28);
    // All 12 materials slots are free even though general is over: 240 units.
    expect(countFit(m.inventory, bagPools(m.bags), MATERIAL, 999)).toBe(240);
    expect(sim.canAddItem(MATERIAL, 240)).toBe(true);
    // Land the grant through the REAL packer, not a hand-built push: the
    // length pin then proves the 240 units the fit gate promised pack into
    // exactly 12 fresh stacks (fit-matches-grant, the #2139 property).
    addStacked(m.inventory, MATERIAL, 240);
    expect(m.inventory).toHaveLength(29); // 29 > the 28 summed budget, tolerated
    expect(m.inventory.length).toBeGreaterThan(bagCapacity(m.bags));
    expect(sim.canAddItem(MATERIAL, 1)).toBe(false);
    expect(sim.canAddItem(GEAR, 1)).toBe(false);
    expect(sim.canAddItem(FOOD, 1)).toBe(false);
  });

  it('swapping a general bag for a materials satchel is allowed on the TOTAL and lands general over, reversibly', () => {
    // The same ruling's equip arm: the swap grows the TOTAL (22 to 28), so the
    // guard permits it even though the general pool shrinks below the 22
    // non-material slots it holds. The player lands in the tolerated-overflow
    // state (non-material pickups refused, materials pool open) and can always
    // swap back, so nothing is ever stranded irrecoverably.
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 0);
    m.inventory = [
      ...Array.from({ length: 21 }, () => ({ itemId: GEAR, count: 1 })),
      { itemId: 'foragers_haversack', count: 1 },
    ];
    sim.drainEvents();
    sim.equipBag('foragers_haversack', 0);
    expect(sim.drainEvents().some((e) => e.type === 'error')).toBe(false);
    expect(m.bags[0]).toBe('foragers_haversack');
    expect(m.inventory).toHaveLength(22); // the pouch swapped back into the bags
    expect(bagPools(m.bags)).toEqual({ general: BACKPACK_SLOTS, materials: 12 });
    // 22 non-materials against general 16: refused there, materials pool open.
    expect(sim.canAddItem(GEAR, 1)).toBe(false);
    expect(sim.canAddItem(MATERIAL, 1)).toBe(true);
    // Reversible: the swap back is equally legal on the total (22 vs 22) and
    // restores a fully in-budget general pool.
    sim.equipBag('linen_pouch', 0);
    expect(sim.drainEvents().some((e) => e.type === 'error')).toBe(false);
    expect(m.bags[0]).toBe('linen_pouch');
    expect(bagPools(m.bags)).toEqual({ general: BACKPACK_SLOTS + 6, materials: 0 });
    expect(m.inventory).toHaveLength(22);
  });

  it('the swap guard judges the POST-swap row: a shrink the new bag cannot hold is refused', () => {
    // THE ONLY repo-wide pin that the guard reads the post-swap row. Regress
    // equipBag's `bagCapacity(newBags)` to `bagCapacity(meta.bags)` and every
    // other arm in the repo stays green while this shrink-swap succeeds: the
    // load is judged against the row it is about to LEAVE, so a 32-slot load
    // passes on the 16-slot pack's 32 and lands on the pouch's 22, six items
    // past a budget the player never agreed to and cannot be warned about.
    const sim = makeSim();
    const m = meta(sim);
    const PACK = 'wayfarers_backpack'; // 16 general slots, the joint-largest
    expect(ITEMS[PACK].bagSlots).toBe(16);
    expect(ITEMS.linen_pouch.bagSlots).toBe(6);
    sim.addItem(PACK, 1);
    sim.equipBag(PACK, 0);
    expect(bagCapacity(m.bags)).toBe(BACKPACK_SLOTS + 16);
    // Exactly full at 32: 31 gear plus the pouch waiting to be swapped in.
    // Post-swap the row holds 22, so the correct guard refuses at 32 > 22.
    m.inventory = [
      ...Array.from({ length: 31 }, () => ({ itemId: GEAR, count: 1 })),
      { itemId: 'linen_pouch', count: 1 },
    ];
    sim.drainEvents();
    sim.equipBag('linen_pouch', 0);
    expect(
      sim
        .drainEvents()
        .some(
          (e) => e.type === 'error' && e.text === 'You have too many items to swap to that bag.',
        ),
    ).toBe(true);
    // Refused, and nothing moved: the pack is still socketed and the pouch is
    // still carried, so the player can free room and retry.
    expect(m.bags[0]).toBe(PACK);
    expect(m.bags).toEqual([PACK, null, null, null]);
    expect(sim.countItem('linen_pouch')).toBe(1);
    expect(m.inventory).toHaveLength(32);
  });

  it('over-carry compounds across sockets: swap-first-then-fill reaches 176/112 and is escapable only by unloading materials', () => {
    // THE CORRECTED CEILING RECORD. The over-carry excess a swap can open is
    // NOT bounded at roughly one bag: it is the SUM of the displaced general
    // bags' slots. Each swap is judged against the TOTAL, which the satchel
    // GROWS (80, 88, 96, 104, 112), so a player who swaps every socket before
    // spending any materials headroom passes all four guards and lands 80
    // non-material slots against a 16-slot general pool: 64 over, four bags'
    // worth. The one-bag intuition only holds when the materials headroom is
    // consumed BETWEEN swaps, because the fuller total re-tightens the next
    // guard. Filling that headroom afterwards is still legal, taking the load
    // to 176 slots against a 112 summed budget, and the state is escapable
    // only by unloading materials first: both bag commands refuse until then.
    const sim = makeSim();
    const m = meta(sim);
    const PACK = 'wayfarers_backpack'; // 16 general slots, the joint-largest
    const SATCHEL = 'loombound_reagent_satchel'; // 24 MATERIALS slots
    expect(isMaterialsOnlyBag(ITEMS[PACK])).toBe(false);
    expect(ITEMS[PACK].bagSlots).toBe(16);
    expect(isMaterialsOnlyBag(ITEMS[SATCHEL])).toBe(true);
    expect(ITEMS[SATCHEL].bagSlots).toBe(24);
    // A bag ITEM is a non-material, so the satchels waiting in the inventory
    // count against the general pool exactly like the gear does.
    expect(MATERIAL_ITEM_IDS.has(PACK)).toBe(false);
    expect(MATERIAL_ITEM_IDS.has(SATCHEL)).toBe(false);

    // Start: four general packs equipped through the real command, a general
    // pool of 80, no materials pool, and every one of those 80 slots carried.
    m.inventory.length = 0;
    for (let k = 0; k < BAG_SOCKETS; k++) {
      sim.addItem(PACK, 1);
      sim.equipBag(PACK, k);
    }
    expect(m.bags).toEqual([PACK, PACK, PACK, PACK]);
    expect(bagPools(m.bags)).toEqual({ general: 80, materials: 0 });
    m.inventory = [
      ...Array.from({ length: 76 }, () => ({ itemId: GEAR, count: 1 })),
      ...Array.from({ length: BAG_SOCKETS }, () => ({ itemId: SATCHEL, count: 1 })),
    ];
    expect(m.inventory).toHaveLength(80);
    expect(sim.canAddItem(GEAR, 1)).toBe(false); // exactly full, nothing over yet

    // Every swap is permitted, and each one moves 16 slots of budget out of
    // the general pool and 24 into the materials pool while the carried load
    // never changes: the compounding, one guard-passing step at a time.
    sim.drainEvents();
    for (let k = 1; k <= BAG_SOCKETS; k++) {
      sim.equipBag(SATCHEL, k - 1);
      expect(
        sim.drainEvents().some((e) => e.type === 'error'),
        `swap ${k}`,
      ).toBe(false);
      expect(bagPools(m.bags), `swap ${k}`).toEqual({
        general: 80 - 16 * k,
        materials: 24 * k,
      });
      expect(m.inventory, `swap ${k}`).toHaveLength(80); // the pack swapped back in
    }

    const pools = bagPools(m.bags);
    expect(pools).toEqual({ general: BACKPACK_SLOTS, materials: 96 });
    expect(bagCapacity(m.bags)).toBe(112);
    // 80 non-material slots against a general budget of 16: 64 over, which is
    // four displaced packs and not one.
    expect(m.inventory.every((s) => !MATERIAL_ITEM_IDS.has(s.itemId))).toBe(true);
    expect(m.inventory.length - pools.general).toBe(4 * 16);
    expect(freeBagSlotsFor(m.inventory, pools, GEAR)).toBe(0);
    expect(sim.canAddItem(GEAR, 1)).toBe(false);

    // The materials headroom is REAL, not bookkeeping: all 96 materials slots
    // are free and the fit gate hands over every one of them.
    expect(freeBagSlotsFor(m.inventory, pools, MATERIAL)).toBe(96);
    expect(countFit(m.inventory, pools, MATERIAL, 9999)).toBe(1920); // 96 slots x 20
    expect(sim.canAddItem(MATERIAL, 1920)).toBe(true);
    expect(sim.canAddItem(MATERIAL, 1921)).toBe(false);
    // Land the grant through the REAL packer so the length pin proves the
    // promised units pack into exactly the promised slots (fit-matches-grant).
    addStacked(m.inventory, MATERIAL, 1920);
    expect(m.inventory).toHaveLength(176);
    expect(m.inventory.filter((s) => s.itemId === MATERIAL)).toHaveLength(96);
    expect(m.inventory.length).toBeGreaterThan(bagCapacity(m.bags)); // 176 over 112
    expect(sim.canAddItem(MATERIAL, 1)).toBe(false);
    expect(sim.canAddItem(GEAR, 1)).toBe(false);

    // Both escapes are now refused, and neither refusal costs an item.
    sim.drainEvents();
    sim.equipBag(PACK, 0);
    expect(
      sim
        .drainEvents()
        .some(
          (e) => e.type === 'error' && e.text === 'You have too many items to swap to that bag.',
        ),
    ).toBe(true);
    sim.unequipBag(0);
    expect(
      sim
        .drainEvents()
        .some(
          (e) => e.type === 'error' && e.text === 'You have too many items to remove that bag.',
        ),
    ).toBe(true);
    expect(m.bags).toEqual([SATCHEL, SATCHEL, SATCHEL, SATCHEL]);
    expect(m.inventory).toHaveLength(176);
    // Length alone survives a refusal path that swapped one id for another, so
    // pin the carried NON-material multiset too: the 76 gear and the four packs
    // the swaps displaced are exactly what both refusals had to leave untouched
    // (the 96 material stacks are counted by the length pin above).
    const carriedGoods: Record<string, number> = {};
    for (const s of m.inventory) {
      if (s.itemId !== MATERIAL) carriedGoods[s.itemId] = (carriedGoods[s.itemId] ?? 0) + s.count;
    }
    expect(carriedGoods).toEqual({ [GEAR]: 76, [PACK]: 4 });

    // Escapable, never stranded: unload the materials (the only thing the
    // satchels were holding) and the swap back is legal again.
    m.inventory = m.inventory.filter((s) => s.itemId !== MATERIAL);
    expect(m.inventory).toHaveLength(80);
    sim.drainEvents();
    sim.equipBag(PACK, 0);
    expect(sim.drainEvents().some((e) => e.type === 'error')).toBe(false);
    expect(m.bags).toEqual([PACK, SATCHEL, SATCHEL, SATCHEL]);
    expect(bagPools(m.bags)).toEqual({ general: 32, materials: 72 });
    expect(m.inventory).toHaveLength(80);

    // Conserved throughout: the four packs and four satchels that started the
    // arm are all still here, equipped or carried, none destroyed or duped.
    // The materials are absent because this arm deleted them above.
    const tally: Record<string, number> = {};
    for (const s of m.inventory) tally[s.itemId] = (tally[s.itemId] ?? 0) + s.count;
    for (const b of m.bags) if (b) tally[b] = (tally[b] ?? 0) + 1;
    expect(tally).toEqual({ [GEAR]: 76, [PACK]: 4, [SATCHEL]: 4 });
  });

  it('an over-capacity carried load reports zero general headroom and is never repaired', () => {
    // The Sim-level twin of the pure over-capacity arm above, on shipped
    // content: a tampered 20-slot save against the bare 16-slot backpack keeps
    // every slot and simply refuses new adds, materials included.
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = [null, null, null, null];
    state.inventory = Array.from({ length: 20 }, () => ({ itemId: GEAR, count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Overloaded', { state });
    const m2 = (
      sim2 as never as { players: Map<number, { inventory: InvSlot[]; bags: (string | null)[] }> }
    ).players.get(pid)!;
    const pools = bagPools(m2.bags);
    expect(pools).toEqual({ general: BACKPACK_SLOTS, materials: 0 });
    expect(m2.inventory).toHaveLength(20); // above budget, and left alone
    expect(freeBagSlotsFor(m2.inventory, pools, MATERIAL)).toBe(0);
    expect(freeBagSlotsFor(m2.inventory, pools, GEAR)).toBe(0);
    expect(sim2.canAddItem(MATERIAL, 1, pid)).toBe(false);
  });
});
