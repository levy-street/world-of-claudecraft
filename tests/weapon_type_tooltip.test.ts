import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

// The item tooltip is a private Hud method that only builds an HTML string, so
// exercise it directly on a prototype-only instance (no constructor / DOM),
// mirroring tests/hud_confirm_gates.ts. Only the few fields the weapon/armor slot
// lines read need stubbing: sim.player.level (the requires-level line) and
// sim.cfg.playerClass + sim.equipment (the armor can-equip check).
interface TooltipHarness {
  sim: {
    player: { level: number };
    cfg: { playerClass: string };
    equipment: Record<string, string>;
  };
  itemTooltip(item: ItemDef, compare?: boolean): string;
}

function harness(playerClass = 'rogue'): TooltipHarness {
  const hud = Object.create(Hud.prototype) as unknown as TooltipHarness;
  hud.sim = { player: { level: 80 }, cfg: { playerClass }, equipment: {} };
  return hud;
}

function tooltip(itemId: string, playerClass?: string): string {
  const item = ITEMS[itemId];
  if (!item) throw new Error(`missing test item ${itemId}`);
  // compare=false: the compare block reads more IWorld surface than this slim
  // harness stubs and is out of scope for the slot-line assertions.
  return harness(playerClass).itemTooltip(item, false);
}

describe('weapon type on the item tooltip slot line', () => {
  it('shows a sword its type in a tt-weapon-type span on the slot row', () => {
    const html = tooltip('worn_sword');
    expect(html).toContain('tt-weapon-type');
    expect(html).toContain('>Sword<');
    // Mirrors the armor-weight row: same tt-sub tt-row two-sided layout.
    expect(html).toMatch(/<div class="tt-sub tt-row">.*tt-weapon-type/);
    // Never colored by class like armor weight.
    expect(html).not.toContain('tt-armor');
  });

  it('shows a dagger its type and drops the old standalone Dagger sub-line', () => {
    const html = tooltip('fang_of_korzul');
    expect(html).toContain('tt-weapon-type');
    expect(html).toContain('>Dagger<');
    // The legacy line was a plain `<div class="tt-sub">Dagger</div>` with no
    // tt-row wrapper. Assert that exact standalone form is gone (the type now
    // rides the slot row instead).
    expect(html).not.toContain('<div class="tt-sub">Dagger</div>');
  });

  it('labels a polearm with the newly added type label', () => {
    const html = tooltip('tidereaver_gaff');
    expect(html).toContain('tt-weapon-type');
    expect(html).toContain('>Polearm<');
  });

  it('labels staff and wand types', () => {
    expect(tooltip('gnarled_staff')).toContain('>Staff<');
    expect(tooltip('drowned_tide_scepter')).toContain('>Wand<');
  });

  it('leaves the armor tooltip unchanged: armor-weight row, no weapon-type span', () => {
    // apprentice_robe is cloth chest armor; a mage can wear it (no tt-armor-bad).
    const html = tooltip('apprentice_robe', 'mage');
    expect(html).toContain('tt-armor');
    expect(html).toContain('>Cloth<');
    expect(html).not.toContain('tt-weapon-type');
  });
});
