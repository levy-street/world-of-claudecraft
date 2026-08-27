import { describe, expect, it } from 'vitest';
import { MASTERWROUGHT_EQUIP_CAP } from '../src/sim/equipment_rules';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

// The Masterwrought tooltip tag is an arm of a private Hud method that only
// builds an HTML string, so exercise it on a prototype-only instance the way
// tests/weapon_type_tooltip.test.ts does (no constructor, no DOM). No shipped
// def carries the flag yet, so the defs are hand-built rather than read from
// ITEMS: the tag must render for any flagged def, whatever its source.
interface TooltipHarness {
  sim: {
    player: { level: number };
    cfg: { playerClass: string };
    equipment: Record<string, string>;
  };
  itemTooltip(item: ItemDef, compare?: boolean, instance?: ItemInstancePayload): string;
}

function harness(): TooltipHarness {
  const hud = Object.create(Hud.prototype) as unknown as TooltipHarness;
  hud.sim = { player: { level: 80 }, cfg: { playerClass: 'warrior' }, equipment: {} };
  return hud;
}

const FLAGGED_RING = {
  id: 'test_mw_tooltip_ring',
  name: 'Test Masterwrought Tooltip Ring',
  kind: 'armor',
  slot: 'ring',
  quality: 'epic',
  masterwrought: true,
  requiredLevel: 20,
  stats: { sta: 1 },
  sellValue: 1,
} as ItemDef;

// The exact rendered line: its own gold tt-sub line, never the type seat. The
// literal 2 here and the constants pin in tests/masterwrought_cap.test.ts move
// together on a cap retune.
const TAG_LINE =
  '<div class="tt-sub" style="color:var(--gold)">Unique-Equipped: Masterwrought (2)</div>';

describe('masterwrought tag on the item tooltip', () => {
  it('renders the counted-family tag on its own gold line with the cap number', () => {
    expect(MASTERWROUGHT_EQUIP_CAP).toBe(2);
    expect(harness().itemTooltip(FLAGGED_RING, false)).toContain(TAG_LINE);
  });

  it('renders nothing masterwrought for the same def without the flag', () => {
    const unflagged = { ...FLAGGED_RING, masterwrought: undefined } as ItemDef;
    expect(harness().itemTooltip(unflagged, false)).not.toContain('Masterwrought');
  });

  it('keeps its own line beside the unique-equipped tag on a legendary flagged piece', () => {
    // A legendary flagged def carries BOTH tags: the one-copy rule's tag in
    // the slot row's type seat and the counted family's own gold line. The
    // double-line copy pass is a recorded packet item; this pins only that
    // neither tag displaces the other.
    const legendary = { ...FLAGGED_RING, quality: 'legendary' } as ItemDef;
    const html = harness().itemTooltip(legendary, false);
    expect(html).toContain(TAG_LINE);
    expect(html).toContain('tt-unique');
  });

  it('a promoted (legendary-rolled) copy of an EPIC def earns the unique tag from its instance', () => {
    // Masterwrought phase 13: isUniqueEquipped is instance-aware, so the
    // tooltip tag follows the copy, not just the def. 2026-08-27 scoping
    // correction: the widening is PROMOTION-SCOPED (perfected + legendary
    // rolled, the orange promotion's own mint), so a LEGACY rolled-only
    // payload stays tag-free like the def-only render, which is what makes
    // this arm instance-driven rather than a restatement of the case above.
    const promoted: ItemInstancePayload = { perfected: true, rolled: { quality: 'legendary' } };
    const html = harness().itemTooltip(FLAGGED_RING, false, promoted);
    expect(html).toContain('tt-unique');
    expect(harness().itemTooltip(FLAGGED_RING, false)).not.toContain('tt-unique');
    const legacy = harness().itemTooltip(FLAGGED_RING, false, { rolled: { quality: 'legendary' } });
    expect(legacy).not.toContain('tt-unique');
  });
});
