// #1165: the additive per-instance item payload (signer/charges/rolled/boundTo)
// on InvSlot. Covers the round-trip through save/load, the bag display view-core
// not crashing on an instanced slot, and instanced items staying inert (never
// listed) on the World Market. Professions 2.0 Phase 2 adds the masterwork
// marker (rolled.masterwork plus baked bonus stats): the cases in the second
// describe pin the additive JSONB back-compat (legacy rolled.quality payloads
// keep loading and equipping unchanged) and the masterwork payload round-trip.

import { describe, expect, it } from 'vitest';
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
