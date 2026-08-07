import { describe, expect, it } from 'vitest';
import { MASTERWROUGHT_EQUIP_CAP } from '../src/sim/equipment_rules';
import type { ItemDef } from '../src/sim/types';
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
  itemTooltip(item: ItemDef, compare?: boolean): string;
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
});
