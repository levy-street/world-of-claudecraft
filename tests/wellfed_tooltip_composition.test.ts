// @vitest-environment happy-dom
//
// The COMPOSED item tooltip (Hud.prototype.itemTooltip, the item_kind_line
// idiom) renders EXACTLY ONE Well Fed line for a farm dish and for an apex
// role plate, directly under the sit-down restore line it qualifies. The
// view-level count in tests/wellfed_tooltip_view.test.ts pins the builder's
// own output and the method-scoped source pin there counts the call
// statements; neither can see a second wiring written in another SHAPE (an
// aliased builder, a helper that composes the view), so this arm reads the
// rendered HTML the player gets.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Hud } from '../src/ui/hud';
import { wellFedTooltipLines } from '../src/ui/wellfed_tooltip_view';

function tooltipHtml(itemId: string): string {
  const h = Object.create(Hud.prototype) as unknown as {
    itemTooltip(item: unknown, compare?: boolean): string;
  };
  const item = ITEMS[itemId];
  if (!item) throw new Error(`missing item ${itemId}`);
  return h.itemTooltip(item, false);
}

describe('the composed item tooltip carries exactly one Well Fed line', () => {
  it.each(['evergarden_braised_greens', 'stonepot_stew'])('%s', (id) => {
    const html = tooltipHtml(id);
    expect((html.match(/Well Fed: /g) ?? []).length, `${id} renders one Well Fed line`).toBe(1);
    // The line is the view's own output, placed restore-adjacent: the
    // sentence directly before it is the sit-down restore line, so the two
    // read in the order the player experiences them.
    const fed = wellFedTooltipLines(ITEMS[id]);
    const at = html.indexOf(fed);
    expect(at, `${id} composes the view's line`).toBeGreaterThan(-1);
    const before = html.slice(0, at);
    const prev = before.slice(before.lastIndexOf('<div class="tt-desc">'));
    expect(prev, `${id} restore line precedes the Well Fed line`).toContain('health over');
  });
});
