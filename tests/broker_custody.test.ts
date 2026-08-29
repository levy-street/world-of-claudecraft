// The broker custody pair (src/sim/broker_custody.ts): the escrow extraction
// and its inverse, the grant back into a player's bags. Extraction legality is
// pinned beside its leaf in inventory_extract.test.ts; what lives here is the
// grant half, whose load-bearing behavior is the #2139 contract that the
// capacity pre-check and the grant see the SAME shape (payload plus crafted
// marker), so a refusal never leaves the copy half-delivered and an accepted
// grant never overfills the recipient.

import { describe, expect, it } from 'vitest';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import { extractTradableCopyImpl } from '../src/sim/broker_custody';
import { ITEMS } from '../src/sim/data';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { InvSlot } from '../src/sim/types';

const freshSim = (): Sim => new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });

/** A player with EMPTY bags, so every slot count below is the test's own. */
const emptyHanded = (sim: Sim): { pid: number; meta: PlayerMeta } => {
  const pid = sim.addPlayer('warrior', 'Broker');
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('addPlayer returned an unresolvable pid');
  meta.inventory.length = 0;
  return { pid, meta };
};

/** A plain stackable item id, and one that is not it: the grant target and the
 *  filler that can never merge with it. */
const stackableId = (): string => {
  const id = Object.keys(ITEMS).find((k) => stackSizeOf(ITEMS[k]) > 1);
  if (!id) throw new Error('no stackable item in ITEMS');
  return id;
};

const tradableWeaponId = (): string => {
  const id = Object.keys(ITEMS).find((k) => {
    const d = ITEMS[k];
    return d.kind === 'weapon' && !d.soulbound && !d.noMarketList;
  });
  if (!id) throw new Error('no tradable weapon in ITEMS');
  return id;
};

/** Fill every remaining bag slot with distinct one-off items, so no free slot
 *  and no mergeable stack is left for `keepOut`. */
const fillBags = (meta: PlayerMeta, keepOut: string): void => {
  const fillers = Object.keys(ITEMS).filter((id) => id !== keepOut);
  const capacity = bagCapacity(meta.bags);
  let next = 0;
  while (meta.inventory.length < capacity) {
    const id = fillers[next++];
    if (!id) throw new Error('ran out of distinct filler items');
    meta.inventory.push({ itemId: id, count: 1 });
  }
};

describe('Sim.grantTradableCopy (the escrow grant back)', () => {
  it('lands the copy in the bags and reports that it did', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = stackableId();

    expect(sim.grantTradableCopy(pid, { itemId, count: 2 })).toBe(true);

    const landed = meta.inventory.filter((s) => s.itemId === itemId);
    expect(landed).toHaveLength(1);
    expect(landed[0].count).toBe(2);
  });

  it('refuses an unresolved player', () => {
    const sim = freshSim();
    emptyHanded(sim);
    expect(sim.grantTradableCopy(9999, { itemId: stackableId(), count: 1 })).toBe(false);
  });

  it('refuses when the bags are full, and lands nothing', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = stackableId();
    fillBags(meta, itemId);
    const before = meta.inventory.map((s) => ({ ...s }));

    expect(sim.grantTradableCopy(pid, { itemId, count: 1 })).toBe(false);

    expect(meta.inventory).toEqual(before);
    expect(meta.inventory.some((s) => s.itemId === itemId)).toBe(false);
  });

  // The #2139 contract from the grant side: the pre-check is keyed on the
  // crafted marker exactly as the grant is. A marker-blind check would see room
  // in the unmarked stack, and the grant, which cannot merge into it, would
  // then need a free slot there is none of.
  it('refuses a MARKED copy that only an unmarked stack has room for', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = stackableId();
    meta.inventory.push({ itemId, count: 1 });
    fillBags(meta, itemId);
    const before = meta.inventory.map((s) => ({ ...s }));

    expect(sim.grantTradableCopy(pid, { itemId, count: 1, craftedRecipeId: 'recipe_x' })).toBe(
      false,
    );

    expect(meta.inventory).toEqual(before);
  });

  // The same contract on the payload axis: a plain stack has room, but only for
  // plain copies, so an instanced grant that would need a fresh slot is refused
  // rather than dropped after the fact.
  it('refuses an INSTANCED copy that only a plain stack has room for', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = stackableId();
    meta.inventory.push({ itemId, count: 1 });
    fillBags(meta, itemId);
    const before = meta.inventory.map((s) => ({ ...s }));

    expect(sim.grantTradableCopy(pid, { itemId, count: 1, instance: { signer: 'Ana' } })).toBe(
      false,
    );

    expect(meta.inventory).toEqual(before);
  });

  it('carries the crafted marker onto the landed slot rather than merging it away', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = stackableId();
    meta.inventory.push({ itemId, count: 1 });

    expect(sim.grantTradableCopy(pid, { itemId, count: 1, craftedRecipeId: 'recipe_x' })).toBe(
      true,
    );

    const unmarked = meta.inventory.filter((s) => s.itemId === itemId && !s.craftedRecipeId);
    const marked = meta.inventory.filter((s) => s.craftedRecipeId === 'recipe_x');
    expect(unmarked).toHaveLength(1);
    expect(unmarked[0].count).toBe(1);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ itemId, count: 1, craftedRecipeId: 'recipe_x' });
  });

  it('preserves an instanced payload verbatim, marker included', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = tradableWeaponId();
    const slot: InvSlot = {
      itemId,
      count: 1,
      instance: { signer: 'Ana', rolled: { masterwork: true, stats: { str: 4 } } },
      craftedRecipeId: 'recipe_y',
    };

    expect(sim.grantTradableCopy(pid, slot)).toBe(true);

    const landed = meta.inventory.find((s) => s.itemId === itemId);
    expect(landed).toBeDefined();
    expect(landed?.instance).toEqual(slot.instance);
    expect(landed?.craftedRecipeId).toBe('recipe_y');
    // Deep-cloned out of the caller's slot: the escrow book must not alias the
    // payload now living in a player's bags.
    expect(landed?.instance).not.toBe(slot.instance);
  });
});

describe('the broker custody pair draws NO rng (the module-header claim)', () => {
  it('extraction and grant both leave the shared stream untouched', () => {
    const sim = freshSim();
    const { pid, meta } = emptyHanded(sim);
    const itemId = tradableWeaponId();
    sim.addItemInstance(itemId, { signer: 'Ana' }, pid);
    const index = meta.inventory.findIndex((s) => s.itemId === itemId && s.instance);
    expect(index).toBeGreaterThanOrEqual(0);

    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    // Positive control: prove the observer really counts before asserting zero.
    sim.rng.next();
    expect(draws).toBe(1);
    draws = 0;

    const out = sim.extractTradableCopy(pid, { index, itemId, expectInstance: { signer: 'Ana' } });
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}`);
    sim.extractTradableCopy(9999, { index: 0, itemId }); // the unresolved arm
    expect(sim.grantTradableCopy(pid, out.extracted)).toBe(true);
    expect(sim.grantTradableCopy(9999, out.extracted)).toBe(false);
    fillBags(meta, itemId);
    expect(sim.grantTradableCopy(pid, { itemId: stackableId(), count: 1 })).toBe(false);

    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

// Moved beside the module that owns the behavior (the facade and its
// mount-dismount arm live in broker_custody.ts, not the inventory_extract
// leaf): the tests/CLAUDE.md paired-file rule.
describe('Sim.extractTradableCopy (facade delegate)', () => {
  it('extracts a live instanced copy from a real player and mutates the live inventory', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Escrow');
    const meta = sim.players.get(pid)!;
    const itemId = Object.keys(ITEMS).find((id) => {
      const d = ITEMS[id];
      return d.kind === 'weapon' && !d.soulbound && !d.noMarketList;
    })!;
    sim.addItemInstance(itemId, { signer: 'Escrow' }, pid);
    const index = meta.inventory.findIndex((s) => s.itemId === itemId && s.instance);
    expect(index).toBeGreaterThanOrEqual(0);
    const before = meta.inventory.length;
    const out = sim.extractTradableCopy(pid, {
      index,
      itemId,
      expectInstance: { signer: 'Escrow' },
    });
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}`);
    expect(out.extracted).toEqual({ itemId, count: 1, instance: { signer: 'Escrow' } });
    expect(meta.inventory.length).toBe(before - 1);
    expect(meta.inventory.some((s) => s.itemId === itemId && s.instance)).toBe(false);
  });

  it('refuses an unresolved player as not_found', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    expect(sim.extractTradableCopy(9999, { index: 0, itemId: 'anything' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  // Escrow is the first way a mount can leave a player at all: reins are
  // soulbound AND noDiscard, so nothing could remove one before the Exchange
  // traded them. A live ride is never re-validated once started, so without this
  // the seller keeps the mount's speed for the rest of the session.
  const mountFixture = (): { itemId: string; key: string } => {
    const itemId = Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'mount');
    if (!itemId) throw new Error('no mount item in ITEMS');
    const mount = (ITEMS[itemId] as { mount?: string }).mount;
    if (!mount) throw new Error('mount item carries no mount key');
    return { itemId, key: mount };
  };

  it('dismounts a seller who escrows the mount they are RIDING', () => {
    const { itemId, key } = mountFixture();
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    const meta = sim.players.get(pid)!;
    const entity = sim.entities.get(pid)!;
    sim.addItem(itemId, 1, pid);
    entity.mountKey = key;
    const index = meta.inventory.findIndex((s) => s.itemId === itemId);
    const out = sim.extractTradableCopy(pid, { index, itemId });
    expect(out.ok).toBe(true);
    expect(entity.mountKey).toBe('');
  });

  it('leaves the rider mounted when a BANK copy still confers ownership', () => {
    // mountOwned reads the bags AND the bank, so a seller listing one of two
    // copies still owns the mount and must keep riding it. Dismounting on any
    // mount extraction would punish exactly the player who did nothing wrong.
    const { itemId, key } = mountFixture();
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    const meta = sim.players.get(pid)!;
    const entity = sim.entities.get(pid)!;
    sim.addItem(itemId, 1, pid);
    meta.bank.inventory.push({ itemId, count: 1 });
    entity.mountKey = key;
    const index = meta.inventory.findIndex((s) => s.itemId === itemId);
    expect(sim.extractTradableCopy(pid, { index, itemId }).ok).toBe(true);
    expect(entity.mountKey).toBe(key);
  });

  it('does not touch the ride when the escrowed item is a DIFFERENT mount', () => {
    const { key } = mountFixture();
    const other = Object.keys(ITEMS).find(
      (id) => ITEMS[id].kind === 'mount' && (ITEMS[id] as { mount?: string }).mount !== key,
    );
    if (!other) throw new Error('need a second mount item');
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    const meta = sim.players.get(pid)!;
    const entity = sim.entities.get(pid)!;
    sim.addItem(other, 1, pid);
    entity.mountKey = key;
    const index = meta.inventory.findIndex((s) => s.itemId === other);
    expect(sim.extractTradableCopy(pid, { index, itemId: other }).ok).toBe(true);
    expect(entity.mountKey).toBe(key);
  });
});

describe('the extraction facade side effects', () => {
  it('notifies the quest system exactly on a successful extraction, never on a refusal', () => {
    // A hand-rolled ctx recorder (the item_instance_transfer test idiom):
    // resolve serves a minimal player and the quest callback counts calls.
    const weapon = tradableWeaponId();
    let notified = 0;
    const meta = { inventory: [{ itemId: weapon, count: 1 }] } as unknown as PlayerMeta;
    const e = { mountKey: '' };
    const ctx = {
      resolve: (pid?: number) => (pid === 5 ? { meta, e } : null),
      onInventoryChangedForQuests: () => {
        notified++;
      },
    } as unknown as SimContext;
    const ok = extractTradableCopyImpl(ctx, 5, { index: 0, itemId: weapon });
    expect(ok.ok).toBe(true);
    expect(notified).toBe(1);
    // The slot is gone now, so the same ref refuses, and a refusal must not
    // report an inventory change that never happened.
    const refused = extractTradableCopyImpl(ctx, 5, { index: 0, itemId: weapon });
    expect(refused.ok).toBe(false);
    expect(notified).toBe(1);
  });
});
