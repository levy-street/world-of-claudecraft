// The menu-click-to-confirm-OK window (masterwrought Phase 18, reopened from
// the Phase 17 family-wide record): the mid-cast pins in
// tests/masterwrought_materials.test.ts protect cast-start to completion, but
// the destroy family has an EARLIER window the cast pin cannot see. The bag
// item action menu captures a slot index at menu open, the confirm dialog sits
// on screen for as long as the player thinks, and the bags can shift the whole
// time (a stack consumed, a mail collected, an inv_move). This file pins the
// SIM half of that window: whatever stale index the confirm OK ends up
// sending, the sim's item_copy_ref selection refuses rather than guessing.
//
// The three refusal shapes are exactly the ones src/ui/bag_item_action_menu.ts
// can produce at OK time (its stale-prompt doctrine re-resolves the named copy
// by reference and sends -1 when it vanished):
//   1. a raw stale index now holding a DIFFERENT item id,
//   2. the length-independent vanished-copy token -1, which must refuse even
//      while id-mates sit at other indices (an untargeted fallback would
//      consume a copy the dialog never named), and
//   3. a stale index past the shrunk bag length.
// Each refusal must start no cast and consume nothing. The UI half (the
// reference-identity re-resolution inside the confirm callback itself) is
// DOM-side and out of a sim test's reach; it is exercised only by the menu's
// own suite, which is the flagged remainder of this window's coverage.
import { describe, expect, it } from 'vitest';
import { SUNDERED_ESSENCE_ITEM_ID } from '../src/sim/professions/masterwrought_materials';
import { SUNDERED_ESSENCE_YIELD } from '../src/sim/professions/sundering';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { completeEnchantFamilyCast } from './helpers/enchant_family_cast';

// The same raid-won epic the sunder suite drives (id frozen; renders as
// Bonewrought Dreadhelm).
const RAID_EPIC = 'crownforged_dreadhelm';
const NOT_HELD = 'You are not holding that item.';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = sim.players.get(pid)!;
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!;
  return { p, meta, pid };
}

function errorTexts(sim: Sim): string[] {
  return (sim.drainEvents() as Array<{ type: string; text?: string }>)
    .filter((e) => e.type === 'error')
    .map((e) => e.text ?? '');
}

describe('the destroy confirm window: a stale slot index is refused, never re-guessed', () => {
  it('control: the captured index still valid at OK sunders exactly that copy', () => {
    // The fixture the refusal arms reuse really can succeed, so their
    // refusals are the guard biting and never a broken fixture.
    const sim = makeSim();
    const { p, meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem('linen_scrap', 3, pid);
    sim.addItem(RAID_EPIC, 1, pid);
    sim.drainEvents();
    sim.extractEssence(RAID_EPIC, pid, 1);
    expect(p.castingAbility).not.toBeNull();
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(SUNDERED_ESSENCE_YIELD);
  });

  it('refuses a stale index a DIFFERENT item slid under while the dialog sat open', () => {
    // A bag DRAG cannot cause this (inv_move trades display cells and leaves
    // the array order alone, inventory_order.ts): the shift that moves the
    // item_copy_ref index space is a SPLICE, a lower stack emptying while the
    // dialog sits open. After it, the captured index names the boar, and the
    // sim must refuse rather than sunder whatever sits there now.
    const sim = makeSim();
    const { p, meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem('linen_scrap', 3, pid); // index 0: consumed while the dialog is up
    sim.addItem(RAID_EPIC, 1, pid); // index 1: what the menu click captured
    sim.addItem('roasted_boar', 1, pid); // index 2: slides under the captured index
    sim.removeItem('linen_scrap', 3, pid); // the splice
    expect(meta.inventory[1].itemId).toBe('roasted_boar');
    sim.drainEvents();

    sim.extractEssence(RAID_EPIC, pid, 1); // the confirm OK, with the stale index
    expect(errorTexts(sim)).toEqual([NOT_HELD]);
    expect(p.castingAbility, 'no cast may start on a mismatched cell').toBeNull();
    completeEnchantFamilyCast(sim); // a no-op unless a cast leaked through
    expect(sim.countItem(RAID_EPIC, pid)).toBe(1);
    expect(sim.countItem('roasted_boar', pid)).toBe(1);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
  });

  it('refuses the vanished-copy token -1 outright, id-mates in the bags notwithstanding', () => {
    // The load-bearing arm: -1 is what the confirm OK sends when the copy the
    // dialog named is gone (bag_item_action_menu's length-independent miss
    // token). If the sim ever read a PRESENT-but-invalid index as "no
    // selection named", the id-only fallback walk would start the cast and
    // eat the signed copy the player never picked; both copies surviving is
    // the assertion with teeth.
    const sim = makeSim();
    const { p, meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(RAID_EPIC, 1, pid);
    sim.addItemInstance(RAID_EPIC, { signer: meta.name }, pid, 1);
    sim.drainEvents();

    sim.extractEssence(RAID_EPIC, pid, -1);
    expect(errorTexts(sim)).toEqual([NOT_HELD]);
    expect(p.castingAbility, 'the miss token may never fall back to a guess').toBeNull();
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(2);
    expect(meta.inventory.filter((s) => s.itemId === RAID_EPIC && s.instance?.signer)).toHaveLength(
      1,
    );
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
  });

  it('refuses a stale index past the length the bags shrank to', () => {
    const sim = makeSim();
    const { p, meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem('linen_scrap', 3, pid); // index 0: consumed while the dialog was up
    sim.addItem(RAID_EPIC, 1, pid); // index 1: the captured cell
    sim.removeItem('linen_scrap', 3, pid); // the splice: the epic is index 0 now
    expect(meta.inventory).toHaveLength(1);
    sim.drainEvents();

    sim.extractEssence(RAID_EPIC, pid, 1); // one past the shrunk length
    expect(errorTexts(sim)).toEqual([NOT_HELD]);
    expect(p.castingAbility).toBeNull();
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(1);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
  });
});
