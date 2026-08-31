// The Crucible Quartermaster: the sigil-redemption buy path (one matching
// sigil debited from bags, class gate, range, stock, space-before-debit) and
// the pure class-filtered shop view. The item stat/budget pins live in
// tests/ignivar_loot.test.ts.

import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_VENDOR_NPC_ID,
  CRUCIBLE_VENDOR_STOCK,
  IGNIVAR_VENDOR_NPCS,
} from '../src/sim/content/ignivar_loot';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { buildCrucibleVendorView } from '../src/ui/hud/vendor/crucible_vendor_view';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// The vendor is a dynamic NPC spawned inside the raid's approach room, so the
// buy-path tests enter through the /dev practice-raid door like
// tests/ignivar_dev_raid.test.ts.
function raidSim(playerClass: 'warrior' | 'mage' = 'warrior'): AnySim {
  const sim = new Sim({
    seed: 2786,
    playerClass,
    autoEquip: true,
    devCommands: true,
  }) as AnySim;
  sim.chat('/dev ignivarraid');
  return sim;
}

function vendorEntity(sim: AnySim): AnyEntity {
  const npc = [...sim.entities.values()].find(
    (e: AnyEntity) => e.kind === 'npc' && e.templateId === CRUCIBLE_VENDOR_NPC_ID,
  );
  if (!npc) throw new Error('Crucible Quartermaster did not spawn in the approach room');
  return npc as AnyEntity;
}

function standAtVendor(sim: AnySim): void {
  const npc = vendorEntity(sim);
  const p = sim.player as AnyEntity;
  p.pos = { x: npc.pos.x + 1, y: p.pos.y, z: npc.pos.z };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function errorTexts(sim: AnySim): string[] {
  return (sim.drainEvents() as any[]).flatMap((e) => (e.type === 'error' ? [e.text] : []));
}

describe('crucible quartermaster: spawn and dialog routing', () => {
  it('spawns in the approach room with the crucibleVendor dialog flag', () => {
    const sim = raidSim();
    const npc = vendorEntity(sim);
    expect(npc).toBeTruthy();
    expect(IGNIVAR_VENDOR_NPCS[CRUCIBLE_VENDOR_NPC_ID].crucibleVendor).toBe(true);
    expect(IGNIVAR_VENDOR_NPCS[CRUCIBLE_VENDOR_NPC_ID].dynamic).toBe(true);
  });
});

describe('crucible quartermaster: buy path', () => {
  it('debits the matching sigil and grants the set piece', () => {
    const sim = raidSim('warrior');
    standAtVendor(sim);
    sim.addItem('sigil_anvil_helmet', 2, sim.playerId);
    sim.drainEvents();

    sim.buyCrucibleVendorItem('slagbreaker_helmet', sim.playerId);

    expect(sim.countItem('slagbreaker_helmet', sim.playerId)).toBe(1);
    expect(sim.countItem('sigil_anvil_helmet', sim.playerId)).toBe(1);
    expect(
      (sim.drainEvents() as any[]).some(
        (e) => e.type === 'vendor' && e.action === 'buy' && e.itemId === 'slagbreaker_helmet',
      ),
    ).toBe(true);
  });

  it('redemptions repeat: each buy debits exactly one sigil from the stack', () => {
    const sim = raidSim('warrior');
    standAtVendor(sim);
    sim.addItem('sigil_anvil_helmet', 3, sim.playerId);
    sim.drainEvents();

    sim.buyCrucibleVendorItem('slagbreaker_helmet', sim.playerId);
    sim.buyCrucibleVendorItem('slagbreaker_helmet', sim.playerId);

    expect(sim.countItem('slagbreaker_helmet', sim.playerId)).toBe(2);
    expect(sim.countItem('sigil_anvil_helmet', sim.playerId)).toBe(1);
  });

  it('refuses without the matching sigil (a different slot sigil does not pay)', () => {
    const sim = raidSim('warrior');
    standAtVendor(sim);
    sim.addItem('sigil_anvil_gloves', 1, sim.playerId);
    sim.drainEvents();

    sim.buyCrucibleVendorItem('slagbreaker_helmet', sim.playerId);

    expect(sim.countItem('slagbreaker_helmet', sim.playerId)).toBe(0);
    expect(sim.countItem('sigil_anvil_gloves', sim.playerId)).toBe(1);
    expect(errorTexts(sim).join(' ')).toContain('You need a Helm Sigil of the Anvil');
  });

  it("refuses another class's piece even with the right sigil in hand", () => {
    // A warrior holds an Anvil helm sigil; Aetherweave is the mage set in the
    // same Anvil group, so only the class gate stands between them.
    const sim = raidSim('warrior');
    standAtVendor(sim);
    sim.addItem('sigil_anvil_helmet', 1, sim.playerId);
    sim.drainEvents();

    sim.buyCrucibleVendorItem('chronoweave_helmet', sim.playerId);

    expect(sim.countItem('chronoweave_helmet', sim.playerId)).toBe(0);
    expect(sim.countItem('sigil_anvil_helmet', sim.playerId)).toBe(1);
    expect(errorTexts(sim)).toContain('You cannot equip that.');
  });

  it('refuses items that are not in the redemption stock', () => {
    const sim = raidSim('warrior');
    standAtVendor(sim);
    sim.drainEvents();

    sim.buyCrucibleVendorItem('cord_of_the_last_flame', sim.playerId);

    expect(sim.countItem('cord_of_the_last_flame', sim.playerId)).toBe(0);
    expect(errorTexts(sim)).toContain('That item is not sold here.');
  });

  it('refuses out of range, before any debit', () => {
    const sim = raidSim('warrior');
    // Still at the room entry, not at the vendor.
    const npc = vendorEntity(sim);
    const p = sim.player as AnyEntity;
    p.pos = { x: npc.pos.x + 40, y: p.pos.y, z: npc.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.addItem('sigil_anvil_helmet', 1, sim.playerId);
    sim.drainEvents();

    sim.buyCrucibleVendorItem('slagbreaker_helmet', sim.playerId);

    expect(sim.countItem('slagbreaker_helmet', sim.playerId)).toBe(0);
    expect(sim.countItem('sigil_anvil_helmet', sim.playerId)).toBe(1);
    expect(errorTexts(sim)).toContain('Too far away.');
  });

  it('checks bag space BEFORE the debit so a full-bags refusal keeps the sigil', () => {
    const sim = raidSim('warrior');
    standAtVendor(sim);
    sim.addItem('sigil_anvil_helmet', 1, sim.playerId);
    // Fill every remaining slot with unstackable items.
    for (let filled = 0; sim.canAddItem('slagbreaker_helmet', 1, sim.playerId); filled++) {
      sim.addItem('slagbreaker_chest', 1, sim.playerId);
      if (filled > 200) throw new Error('bags never filled');
    }
    sim.drainEvents();

    sim.buyCrucibleVendorItem('slagbreaker_helmet', sim.playerId);

    expect(sim.countItem('slagbreaker_helmet', sim.playerId)).toBe(0);
    expect(sim.countItem('sigil_anvil_helmet', sim.playerId)).toBe(1);
    expect(errorTexts(sim).length).toBeGreaterThan(0);
  });
});

describe('crucible vendor view (pure core)', () => {
  const count = (held: Record<string, number>) => (sigilId: string) => held[sigilId] ?? 0;

  it('filters the stock to the viewer class and prices rows by sigil possession', () => {
    const view = buildCrucibleVendorView(
      CRUCIBLE_VENDOR_STOCK,
      ITEMS,
      'warrior',
      count({ sigil_anvil_helmet: 1 }),
    );
    // Warrior: 3 sets x 5 slots.
    expect(view.rows.length).toBe(15);
    for (const row of view.rows) {
      expect(row.item.requiredClass).toContain('warrior');
      expect(row.affordable).toBe(row.sigilId === 'sigil_anvil_helmet');
    }
    expect(view.balances).toEqual([
      expect.objectContaining({ sigilId: 'sigil_anvil_helmet', count: 1 }),
    ]);
  });

  it('druid and shaman see four sets (the hybrid tank lane)', () => {
    const druid = buildCrucibleVendorView(CRUCIBLE_VENDOR_STOCK, ITEMS, 'druid', count({}));
    const shaman = buildCrucibleVendorView(CRUCIBLE_VENDOR_STOCK, ITEMS, 'shaman', count({}));
    expect(druid.rows.length).toBe(20);
    expect(shaman.rows.length).toBe(20);
    expect(druid.balances).toEqual([]);
  });

  it('drops rows whose item or sigil id does not resolve', () => {
    const view = buildCrucibleVendorView(
      [{ itemId: 'no_such_piece', sigilId: 'sigil_anvil_helmet' }, ...CRUCIBLE_VENDOR_STOCK],
      ITEMS,
      'mage',
      count({}),
    );
    expect(view.rows.some((row) => row.itemId === 'no_such_piece')).toBe(false);
    expect(view.rows.length).toBe(15);
  });
});
