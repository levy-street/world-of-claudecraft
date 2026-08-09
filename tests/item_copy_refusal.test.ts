// A REFUSED copy selection must change nothing, on every surface that takes one.
//
// The tri-state in src/sim/item_copy_ref.ts says a caller must branch on all three
// outcomes: consumed, refused, or no-selection-so-fall-back. Collapsing refuse into
// "nothing consumed, carry on" is not a lesser version of honoring it, it is a
// different bug, and review found two exploitable instances:
//
//   useItem   granted the full effect (heal, cooldown, aura, sit) while the consume
//             refused, so a frame naming a bad slot yielded free potions, food and
//             elixirs, repeatable forever. Reachable by an honest client too: the
//             bags click path sends bagStackIndex(...) unguarded, which is -1 on a
//             stale click.
//   equipItem deleted the DISPLACED piece before the consume ran, so a refused
//             selection destroyed the item being replaced: neither worn nor in bags,
//             with its stats still applied because recalc never ran.
//
// Every case below asserts the same shape: after a refused selection, the bags and
// the worn set are exactly what they were, and no effect landed. One per surface,
// because both bugs lived in the arms that had no behavior test.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { EquipSlot, InvSlot, PlayerClass } from '../src/sim/types';

/** An out-of-range index: passes the server's Number.isInteger gate, fails the
 *  leaf's range check. This is the shape a stale client frame actually sends. */
const BAD_INDEX = 999;

function makeSim(cls: PlayerClass = 'warrior'): Sim {
  const sim = new Sim({ seed: 5, playerClass: cls, autoEquip: false });
  // Strip the starting kit. autoEquip:false does not mean naked, and a pre-worn
  // chest piece silently invalidated two of these fixtures on the first run.
  const meta = sim.players.get(sim.playerId);
  if (meta) {
    for (const key of Object.keys(meta.equipment) as EquipSlot[]) delete meta.equipment[key];
    meta.equipmentInstance = {};
  }
  return sim;
}

/** Stand the player at a real vendor. Without this the sell arms short-circuit on
 *  "There is no merchant nearby", which made the first sell test VACUOUS: it
 *  asserted nothing changed, and nothing changed because the command never got
 *  past its range gate. */
function standAtVendor(sim: Sim): void {
  const vendor = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && (e.vendorItems?.length ?? 0) > 0,
  );
  if (!vendor) throw new Error('no vendor NPC fixture');
  const p = sim.player;
  p.pos.x = vendor.pos.x;
  p.pos.z = vendor.pos.z;
  p.pos.y = vendor.pos.y;
  p.prevPos = { ...p.pos };
}

function metaOf(sim: Sim) {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('no meta');
  return meta;
}

function firstItem(pred: (d: (typeof ITEMS)[string]) => boolean): string {
  const found = Object.values(ITEMS).find(pred);
  if (!found) throw new Error('no fixture item');
  return found.id;
}

/** A snapshot deep enough to prove "nothing happened". */
function snapshot(sim: Sim) {
  const meta = metaOf(sim);
  return {
    inventory: JSON.parse(JSON.stringify(meta.inventory)) as InvSlot[],
    equipment: { ...meta.equipment },
    equipmentInstance: JSON.parse(JSON.stringify(meta.equipmentInstance ?? {})),
  };
}

describe('a refused selection consumes nothing and grants nothing', () => {
  it('useItem: a potion is neither drunk nor spent', () => {
    // The exploit, as a test. Before the fix the heal and the cooldown landed while
    // the potion stayed in the bags.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const potionId = firstItem((d) => d.kind === 'potion');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: potionId, count: 1 });
    const player = sim.player;
    player.hp = Math.max(1, Math.floor(player.maxHp / 2));
    const hpBefore = player.hp;
    const before = snapshot(sim);
    sim.drainEvents();

    sim.useItem(potionId, pid, BAD_INDEX);

    expect(metaOf(sim).inventory, 'the potion is still held').toEqual(before.inventory);
    expect(sim.player.hp, 'and no heal landed').toBe(hpBefore);
    expect(sim.player.cooldowns.size, 'and no use cooldown was armed').toBe(0);
  });

  it('useItem: food does not start the eating sit', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const foodId = firstItem((d) => d.kind === 'food');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: foodId, count: 1 });
    const before = snapshot(sim);
    sim.drainEvents();

    sim.useItem(foodId, pid, BAD_INDEX);

    expect(metaOf(sim).inventory).toEqual(before.inventory);
    expect(sim.player.sitting, 'the eat sit never began').toBe(false);
  });

  it('equipItem: the DISPLACED piece survives', () => {
    // The destructive one. The worn piece was deleted before the consume, so a
    // refusal left it nowhere at all while its stats stayed applied.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const chestId = firstItem((d) => d.slot === 'chest' && d.kind === 'armor');
    const other = Object.values(ITEMS).find(
      (d) => d.slot === 'chest' && d.kind === 'armor' && d.id !== chestId,
    );
    if (!other) throw new Error('need two chest items');

    meta.equipment.chest = chestId;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: other.id, count: 1 });
    const before = snapshot(sim);
    sim.drainEvents();

    sim.equipItem(other.id, pid, 'chest' as EquipSlot, BAD_INDEX);

    const after = metaOf(sim);
    expect(after.equipment.chest, 'the worn piece is still worn').toBe(chestId);
    expect(after.inventory, 'and the candidate is still in the bags').toEqual(before.inventory);
  });

  it('equipItem: an empty target slot stays empty', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const chestId = firstItem((d) => d.slot === 'chest' && d.kind === 'armor');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: chestId, count: 1 });
    const before = snapshot(sim);
    sim.drainEvents();

    sim.equipItem(chestId, pid, 'chest' as EquipSlot, BAD_INDEX);

    expect(metaOf(sim).equipment.chest).toBeUndefined();
    expect(metaOf(sim).inventory).toEqual(before.inventory);
  });

  it('discardItem: nothing is destroyed', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const id = firstItem((d) => d.kind === 'junk' || d.kind === 'potion');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: id, count: 1 });
    const before = snapshot(sim);
    sim.drainEvents();

    sim.discardItem(id, 1, pid, BAD_INDEX);

    expect(metaOf(sim).inventory).toEqual(before.inventory);
  });

  it('feedPet: the food survives', () => {
    const sim = makeSim('hunter' as PlayerClass);
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const foodId = firstItem((d) => d.kind === 'food');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: foodId, count: 1 });
    const before = snapshot(sim);
    sim.drainEvents();

    sim.feedPet(foodId, pid, BAD_INDEX);

    expect(metaOf(sim).inventory).toEqual(before.inventory);
  });

  it('equipBag: the bag survives and no socket is filled', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const bagId = firstItem((d) => d.kind === 'bag');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: bagId, count: 1 });
    const before = snapshot(sim);
    const bagsBefore = [...meta.bags];
    sim.drainEvents();

    sim.equipBag(bagId, undefined, pid, BAD_INDEX);

    expect(metaOf(sim).inventory).toEqual(before.inventory);
    expect(metaOf(sim).bags, 'no socket was filled').toEqual(bagsBefore);
  });

  it('sellItem: nothing is sold', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const id = firstItem((d) => d.kind === 'junk');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: id, count: 1 });
    standAtVendor(sim);
    const before = snapshot(sim);
    const copperBefore = meta.copper;
    sim.drainEvents();

    sim.sellItem(id, 1, pid, BAD_INDEX);

    expect(metaOf(sim).inventory).toEqual(before.inventory);
    expect(metaOf(sim).copper, 'and no coin changed hands').toBe(copperBefore);
  });

  it('sellItem: naming a slot that holds a DIFFERENT bound item says "don\'t have", not "bound"', () => {
    // The one behavior change of the review round with no test: the bound check
    // read the named slot before matching the item id, so naming a slot holding
    // some other bound item reported it as bound, which is a misleading refusal
    // about an item the player never asked to sell.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const selling = firstItem((d) => d.kind === 'junk');
    const other = Object.values(ITEMS).find((d) => d.kind === 'junk' && d.id !== selling);
    if (!other) throw new Error('need two junk items');
    meta.inventory.length = 0;
    // index 0 holds a DIFFERENT item, and it is bound.
    meta.inventory.push({
      itemId: other.id,
      count: 1,
      instance: { boundTo: 'someone' } as never,
    });
    meta.inventory.push({ itemId: selling, count: 1 });
    standAtVendor(sim);
    sim.drainEvents();

    sim.sellItem(selling, 1, pid, 0);

    const errors = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error')
      .map((e) => e.text);
    expect(errors).toContain("You don't have that item.");
    expect(errors, 'and NOT the bound refusal').not.toContain(
      'That item is bound and cannot be sold.',
    );
  });

  it('the rift forge: a refused selection upgrades nothing', () => {
    // The forge MUTATES its target in place rather than consuming it, so a refusal
    // here would corrupt the wrong copy rather than destroy one. Covered because
    // the resolve-only helper has its own arm.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const id = firstItem((d) => d.slot === 'chest' && d.kind === 'armor');
    meta.inventory.length = 0;
    meta.inventory.push({
      itemId: id,
      count: 1,
      instance: { rift: { tier: 1 } } as never,
    });
    const before = snapshot(sim);
    sim.drainEvents();

    sim.upgradeRiftItem(id, pid, BAD_INDEX);

    expect(metaOf(sim).inventory, 'the copy is untouched').toEqual(before.inventory);
  });

  it('a VALID selection on the same surfaces still works, so the guards are not blanket refusals', () => {
    // Guards the guards. Every assertion above would also pass if the surfaces
    // simply stopped functioning.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    const chestId = firstItem((d) => d.slot === 'chest' && d.kind === 'armor');
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: chestId, count: 1 });
    sim.drainEvents();

    sim.equipItem(chestId, pid, 'chest' as EquipSlot, 0);
    expect(metaOf(sim).equipment.chest, 'index 0 is a valid selection').toBe(chestId);
    expect(metaOf(sim).inventory.filter((s) => s.itemId === chestId)).toHaveLength(0);
  });
});
