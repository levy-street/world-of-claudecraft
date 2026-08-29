// The vendor stock gate's pure core: quest-gated rows hide until their quest
// is in the viewer's log, reappear while it is active, and stay once done;
// ungated vendors and rows pass through untouched. Same-input-same-output
// against both a Sim-shaped and a ClientWorld-shaped viewer (both expose
// questLog/questsDone through IWorld).

import { describe, expect, it } from 'vitest';
import { visibleVendorStock } from '../src/ui/vendor_stock_gate_core';

const FINCH = {
  templateId: 'quartermaster_finch',
  vendorItems: ['minor_healing_potion', 'baked_bread', 'spring_water', 'linen_pouch'],
};

describe('vendor stock gate core', () => {
  it('hides the gated row for a viewer without the quest', () => {
    const stock = visibleVendorStock(FINCH, new Map(), new Set());
    expect(stock).toEqual(['minor_healing_potion', 'baked_bread', 'spring_water']);
  });

  it('shows the gated row while the quest is active, and once done', () => {
    const active = visibleVendorStock(FINCH, new Map([['q_ps_pouch_and_purse', {}]]), new Set());
    expect(active).toContain('linen_pouch');
    const done = visibleVendorStock(FINCH, new Map(), new Set(['q_ps_pouch_and_purse']));
    expect(done).toContain('linen_pouch');
  });

  it('passes an ungated vendor through untouched', () => {
    const npc = { templateId: 'trader_wilkes', vendorItems: ['baked_bread'] };
    expect(visibleVendorStock(npc, new Map(), new Set())).toEqual(['baked_bread']);
  });
});
