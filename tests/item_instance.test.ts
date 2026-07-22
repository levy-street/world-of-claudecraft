// #1165: the additive per-instance item payload (signer/charges/rolled/boundTo)
// on InvSlot. Covers the round-trip through save/load, the bag display view-core
// not crashing on an instanced slot, and instanced items staying inert (never
// listed) on the World Market. Professions 2.0 Phase 2 adds the masterwork
// marker (rolled.masterwork plus baked bonus stats): the cases in the second
// describe pin the additive JSONB back-compat (legacy rolled.quality payloads
// keep loading and equipping unchanged) and the masterwork payload round-trip.

import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { isEnchantedInstance } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import { cloneItemInstancePayload, type Entity, type ItemInstancePayload } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { buildBagGrid } from '../src/ui/bags_view';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function standAtMerchant(sim: Sim, pid: number) {
  let merchant: Entity | undefined;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'the_merchant') {
      merchant = e;
      break;
    }
  }
  if (!merchant) throw new Error('the Merchant was not spawned');
  const e = sim.entities.get(pid)!;
  e.pos.x = merchant.pos.x;
  e.pos.z = merchant.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

describe('item-instance payload (#1165)', () => {
  it('an instanced item survives a save/load round-trip', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.addItemInstance(
      'apprentice_staff',
      {
        signer: 'Aldric',
        charges: { fireball: 3 },
        rolled: { quality: 'rare' },
        boundTo: sim.playerId,
      },
      sim.playerId,
    );

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(saved?.instance).toEqual({
      signer: 'Aldric',
      charges: { fireball: 3 },
      rolled: { quality: 'rare' },
      boundTo: sim.playerId,
    });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const loaded = sim2.meta(pid2)?.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(loaded?.count).toBe(1);
    expect(loaded?.instance).toEqual({
      signer: 'Aldric',
      charges: { fireball: 3 },
      rolled: { quality: 'rare' },
      boundTo: sim.playerId,
    });
  });

  it('mutating a serialized snapshot does not alias the live instance payload (charges/rolled.stats)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.addItemInstance(
      'apprentice_staff',
      { signer: 'Aldric', charges: { fireball: 3 }, rolled: { stats: { spellPower: 5 } } },
      sim.playerId,
    );

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'apprentice_staff')!;
    // decrementing the saved snapshot's charge/stat must not mutate the live slot
    saved.instance!.charges!.fireball = 0;
    saved.instance!.rolled!.stats!.spellPower = 0;

    const live = sim.meta(sim.playerId)?.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(live?.instance?.charges?.fireball).toBe(3);
    expect(live?.instance?.rolled?.stats?.spellPower).toBe(5);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    // mutating the loaded copy must not reach back into the (already-mutated) saved state
    const loaded = sim2.meta(pid2)?.inventory.find((s) => s.itemId === 'apprentice_staff');
    loaded!.instance!.charges!.fireball = 1;
    expect(saved.instance?.charges?.fireball).toBe(0);
  });

  it('an ordinary fungible stack round-trips unaffected (no instance field)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.addItem('wolf_fang', 3, sim.playerId);

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(saved).toEqual({ itemId: 'wolf_fang', count: 3 });
    expect(saved && 'instance' in saved).toBe(false);
  });

  it('addItem never merges a plain grant into an existing instanced slot', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.addItemInstance('apprentice_staff', { signer: 'Aldric' }, sim.playerId);
    sim.addItem('apprentice_staff', 1, sim.playerId);

    const slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'apprentice_staff');
    expect(slots.length).toBe(2);
    expect(slots.some((s) => s.instance?.signer === 'Aldric' && s.count === 1)).toBe(true);
    expect(slots.some((s) => !s.instance && s.count === 1)).toBe(true);
  });

  it('the bag display view-core renders an instanced slot without crashing', () => {
    const model = buildBagGrid(
      [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'apprentice_staff', count: 1, instance: { signer: 'Aldric', boundTo: 7 } },
      ],
      (itemId: string) => ITEMS[itemId],
      { category: 'all', sort: 'name', search: '' },
    );
    expect(model.state).toBe('items');
    expect(model.visible.length).toBe(2);
    const instanced = model.visible.find((s) => s.itemId === 'apprentice_staff');
    expect(instanced?.instance?.signer).toBe('Aldric');
  });

  it('an instanced item is inert on the World Market: listing it is rejected', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItemInstance('apprentice_staff', { signer: 'Aldric' }, seller);

    sim.marketList('apprentice_staff', 1, 100, seller);

    const errors = sim.events.filter((e) => e.type === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(sim.marketListings.some((l) => l.itemId === 'apprentice_staff')).toBe(false);
    // the instanced copy is untouched, still in the seller's bag
    expect(
      sim.meta(seller)?.inventory.some((s) => s.itemId === 'apprentice_staff' && s.instance),
    ).toBe(true);
  });

  it('a fungible stack still lists normally alongside an unrelated instanced copy', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    standAtMerchant(sim, seller);
    sim.addItem('apprentice_staff', 1, seller);
    sim.addItemInstance('apprentice_staff', { signer: 'Aldric' }, seller);

    sim.marketList('apprentice_staff', 1, 100, seller);

    expect(sim.marketListings.some((l) => l.itemId === 'apprentice_staff')).toBe(true);
    // the instanced copy was never touched by the escrow
    expect(
      sim.meta(seller)?.inventory.some((s) => s.itemId === 'apprentice_staff' && s.instance),
    ).toBe(true);
  });
});

describe('masterwork and legacy instance payloads (Professions 2.0 Phase 2 back-compat)', () => {
  it('a legacy rolled.quality payload still loads, clones without aliasing, and equips unchanged', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    // The Phase 2 model retired NEW rolled.quality writes; a persisted legacy
    // payload (pre-Phase 2 signed craft) must keep loading exactly as saved.
    sim.addItemInstance('cryptbone_greaves', { rolled: { quality: 'rare' } }, sim.playerId);

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'cryptbone_greaves')!;
    expect(saved.instance).toEqual({ rolled: { quality: 'rare' } });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const loaded = sim2.meta(pid2)?.inventory.find((s) => s.itemId === 'cryptbone_greaves');
    expect(loaded?.instance).toEqual({ rolled: { quality: 'rare' } });

    // Non-aliasing: mutating the snapshot's rolled record reaches neither the
    // live payload nor the loaded copy.
    saved.instance!.rolled!.quality = 'legendary';
    expect(
      sim.meta(sim.playerId)?.inventory.find((s) => s.itemId === 'cryptbone_greaves')?.instance
        ?.rolled?.quality,
    ).toBe('rare');
    expect(loaded?.instance?.rolled?.quality).toBe('rare');

    // Equips unchanged: the legacy quality is inert metadata. The instance
    // rides into the worn slot intact, and the stat delta is exactly the def's
    // own line (cryptbone_greaves: armor 48, sta 2), identical to a plain copy.
    const before = { ...sim.entities.get(sim.playerId)!.stats };
    sim.equipItem('cryptbone_greaves', sim.playerId);
    const meta = sim.meta(sim.playerId)!;
    expect(meta.equipment.legs).toBe('cryptbone_greaves');
    expect(meta.equipmentInstance?.legs).toEqual({ rolled: { quality: 'rare' } });
    const after = sim.entities.get(sim.playerId)!.stats;
    expect(after.armor - before.armor).toBe(48);
    expect(after.sta - before.sta).toBe(2);

    const plain = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    plain.addItem('cryptbone_greaves', 1, plain.playerId);
    plain.equipItem('cryptbone_greaves', plain.playerId);
    expect(sim.entities.get(sim.playerId)!.stats).toEqual(
      plain.entities.get(plain.playerId)!.stats,
    );
  });

  it('a masterwork payload round-trips save/load with non-aliasing', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.addItemInstance(
      'apprentice_staff',
      { signer: 'Aldric', rolled: { masterwork: true, stats: { int: 2, spi: 1 } } },
      sim.playerId,
    );

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'apprentice_staff')!;
    expect(saved.instance).toEqual({
      signer: 'Aldric',
      rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
    });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const loaded = sim2.meta(pid2)?.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(loaded?.instance).toEqual({
      signer: 'Aldric',
      rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
    });

    // Non-aliasing: stripping the snapshot's masterwork marker or zeroing its
    // baked stats reaches neither the live payload nor the loaded copy.
    saved.instance!.rolled!.masterwork = false;
    saved.instance!.rolled!.stats!.int = 0;
    const live = sim.meta(sim.playerId)?.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(live?.instance?.rolled?.masterwork).toBe(true);
    expect(live?.instance?.rolled?.stats?.int).toBe(2);
    expect(loaded?.instance?.rolled?.masterwork).toBe(true);
    expect(loaded?.instance?.rolled?.stats?.int).toBe(2);
  });

  it('cloneItemInstancePayload deep-clones the masterwork marker alongside its stats', () => {
    const src: ItemInstancePayload = {
      signer: 'Aldric',
      rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
    };
    const clone = cloneItemInstancePayload(src);
    expect(clone).toEqual(src);
    expect(clone.rolled).not.toBe(src.rolled);
    expect(clone.rolled?.stats).not.toBe(src.rolled?.stats);
    clone.rolled!.masterwork = false;
    clone.rolled!.stats!.int = 99;
    expect(src.rolled?.masterwork).toBe(true);
    expect(src.rolled?.stats?.int).toBe(2);
  });

  it('a combined legacy quality + stats + masterwork payload survives save/load intact', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.addItemInstance(
      'apprentice_staff',
      {
        signer: 'Aldric',
        rolled: { quality: 'rare', stats: { spellPower: 5 }, masterwork: true },
        boundTo: sim.playerId,
      },
      sim.playerId,
    );

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(saved?.instance).toEqual({
      signer: 'Aldric',
      rolled: { quality: 'rare', stats: { spellPower: 5 }, masterwork: true },
      boundTo: sim.playerId,
    });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    expect(
      sim2.meta(pid2)?.inventory.find((s) => s.itemId === 'apprentice_staff')?.instance,
    ).toEqual({
      signer: 'Aldric',
      rolled: { quality: 'rare', stats: { spellPower: 5 }, masterwork: true },
      boundTo: sim.playerId,
    });
  });

  it('the top-level enchant marker survives save/load intact and keeps the copy enchant-guarded', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    // The exact post-Phase-2 shape of an enchanted masterwork copy: signer plus
    // rolled.masterwork plus baked stats plus the authoritative top-level
    // enchant id (types.ts ItemInstancePayload.enchant). If persistence dropped
    // the marker, isEnchantedInstance would fall through to the masterwork arm
    // (NOT enchanted) and a reloaded copy could be enchanted twice.
    sim.addItemInstance(
      'apprentice_staff',
      {
        signer: 'Aldric',
        enchant: 'enchant_weapon_might',
        rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
      },
      sim.playerId,
    );

    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.find((s) => s.itemId === 'apprentice_staff')!;
    expect(saved.instance?.enchant).toBe('enchant_weapon_might');

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const loaded = sim2.meta(pid2)?.inventory.find((s) => s.itemId === 'apprentice_staff');
    expect(loaded?.instance).toEqual({
      signer: 'Aldric',
      enchant: 'enchant_weapon_might',
      rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
    });
    // The reloaded copy still reads as already enchanted, so the double-enchant
    // guard holds across a save/load cycle.
    expect(isEnchantedInstance(loaded!.instance!)).toBe(true);
    // And the payload cloner carries the marker alongside signer and rolled.
    const clone = cloneItemInstancePayload(loaded!.instance!);
    expect(clone.enchant).toBe('enchant_weapon_might');
  });
});

describe('identical-payload stacking (Professions 2.0 Phase 12d)', () => {
  const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });

  it('two same-signer grants merge into ONE slot at count 2; a third keeps merging', () => {
    const sim = makeSim();
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    let slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(1);
    expect(slots[0].count).toBe(2);
    expect(slots[0].instance).toEqual({ signer: 'Ana' });
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(1);
    expect(slots[0].count).toBe(3);
  });

  it('a signer mismatch and plain-vs-signed both keep their own slots', () => {
    const sim = makeSim();
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    sim.addItemInstance('wolf_fang', { signer: 'Bru' }, sim.playerId);
    sim.addItem('wolf_fang', 1, sim.playerId);
    const slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.count === 1)).toBe(true);
  });

  it('an enchanted or bound copy never merges with a merely-signed stack', () => {
    const sim = makeSim();
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    sim.addItemInstance(
      'wolf_fang',
      { signer: 'Ana', enchant: 'enchant_weapon_might' },
      sim.playerId,
    );
    sim.addItemInstance('wolf_fang', { signer: 'Ana', boundTo: 7 }, sim.playerId);
    const slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.count === 1)).toBe(true);
  });

  it('the stack cap holds AT the boundary: the 20th copy merges, the 21st takes a new slot', () => {
    const sim = makeSim();
    expect(stackSizeOf(ITEMS.wolf_fang)).toBe(20);
    for (let i = 0; i < 20; i++) sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    let slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(1);
    expect(slots[0].count).toBe(20);
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.count).sort((a, b) => a - b)).toEqual([1, 20]);
  });

  it('an UNSTACKED kind (weapon, stackSize 1) never merges even with byte-equal payloads', () => {
    const sim = makeSim();
    expect(stackSizeOf(ITEMS.apprentice_staff)).toBe(1);
    sim.addItemInstance('apprentice_staff', { signer: 'Ana' }, sim.playerId);
    sim.addItemInstance('apprentice_staff', { signer: 'Ana' }, sim.playerId);
    const slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'apprentice_staff');
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.count === 1)).toBe(true);
  });

  it('byte-equal charge-bearing payloads stay one-per-slot (mergeability guard)', () => {
    const sim = makeSim();
    sim.addItemInstance('wolf_fang', { signer: 'Ana', charges: { zap: 3 } }, sim.playerId);
    sim.addItemInstance('wolf_fang', { signer: 'Ana', charges: { zap: 3 } }, sim.playerId);
    const slots = sim.meta(sim.playerId)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.count === 1)).toBe(true);
  });

  it('removeItem across a counted instanced stack returns one payload per unit', () => {
    const sim = makeSim();
    for (let i = 0; i < 3; i++) sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    const consumed = sim.removeItem('wolf_fang', 3, sim.playerId);
    expect(consumed).toHaveLength(3);
    for (const inst of consumed) expect(inst).toEqual({ signer: 'Ana' });
    expect(sim.meta(sim.playerId)!.inventory.some((s) => s.itemId === 'wolf_fang')).toBe(false);
  });

  it('removeItem partial take returns a clone: the surviving stack payload is never aliased', () => {
    // The removeEnchantableItem sibling below covers the live enchant mutator;
    // this is the removeItem arm of the same clone-on-survival contract (the
    // coverage audit's defensive-symmetry ask).
    const sim = makeSim();
    for (let i = 0; i < 3; i++) sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    const [consumed] = sim.removeItem('wolf_fang', 1, sim.playerId);
    expect(consumed).toEqual({ signer: 'Ana' });
    consumed.signer = 'Mallory';
    const survivor = sim.meta(sim.playerId)!.inventory.find((s) => s.itemId === 'wolf_fang')!;
    expect(survivor.count).toBe(2);
    expect(survivor.instance).toEqual({ signer: 'Ana' });
  });

  it('a partially-consumed stack returns deep clones: mutating them never reaches the survivor', () => {
    const sim = makeSim();
    // A masterwork payload: enchant-ELIGIBLE (isEnchantedInstance is false for
    // the masterwork arm), unlike bare rolled.stats which reads as a legacy
    // enchant and would be skipped by removeEnchantableItem entirely.
    const payload = { signer: 'Ana', rolled: { masterwork: true, stats: { str: 1 } } };
    sim.addItemInstance('wolf_fang', { ...payload, rolled: { ...payload.rolled } }, sim.playerId);
    sim.addItemInstance('wolf_fang', { ...payload, rolled: { ...payload.rolled } }, sim.playerId);
    const [consumed] = sim.removeEnchantableItem('wolf_fang', 1, sim.playerId);
    expect(consumed).toEqual({ signer: 'Ana', rolled: { masterwork: true, stats: { str: 1 } } });
    // The enchant path mutates the payload it gets back; the surviving stack's
    // shared payload must stay untouched.
    consumed.enchant = 'enchant_weapon_might';
    consumed.rolled!.stats!.str = 99;
    const survivor = sim.meta(sim.playerId)!.inventory.find((s) => s.itemId === 'wolf_fang')!;
    expect(survivor.count).toBe(1);
    expect(survivor.instance).toEqual({
      signer: 'Ana',
      rolled: { masterwork: true, stats: { str: 1 } },
    });
  });

  it('a count-3 signed stack round-trips serializeCharacter as one slot', () => {
    const sim = makeSim();
    for (let i = 0; i < 3; i++) sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    const state = sim.serializeCharacter(sim.playerId)!;
    const saved = state.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' } });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Reloaded', { state });
    const loaded = sim2.meta(pid2)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].count).toBe(3);
    expect(loaded[0].instance).toEqual({ signer: 'Ana' });
  });

  it('addPlayer clamps a tampered counted instanced slot with the same rule as the bank arm (12d QA)', () => {
    const sim = makeSim();
    sim.addItemInstance('wolf_fang', { signer: 'Ana' }, sim.playerId);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(sim.playerId)!));
    const signed = state.inventory.find(
      (s: { itemId: string; instance?: unknown }) => s.itemId === 'wolf_fang' && s.instance,
    );
    signed.count = 999; // hand-edited past the merge-legal cap
    state.inventory.push({
      itemId: 'wolf_fang',
      count: 4, // a counted stack shares ONE payload: a charge count over 1 would mint copies
      instance: { signer: 'Ana', charges: { zap: 2 } },
    });
    state.inventory.push({
      itemId: 'unknown_id_xyz', // a removed def: dormant recoverable data, never destroyed
      count: 30,
      instance: { signer: 'Old' },
    });

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid2 = sim2.addPlayer('warrior', 'Tampered', { state });
    const inv = sim2.meta(pid2)!.inventory;
    const counts = (pred: (s: (typeof inv)[number]) => boolean) =>
      inv.filter(pred).map((s) => s.count);
    expect(counts((s) => s.itemId === 'wolf_fang' && !!s.instance && !s.instance.charges)).toEqual([
      stackSizeOf(ITEMS.wolf_fang),
    ]);
    expect(counts((s) => s.itemId === 'wolf_fang' && !!s.instance?.charges)).toEqual([1]);
    expect(counts((s) => s.itemId === 'unknown_id_xyz')).toEqual([30]);
  });
});
