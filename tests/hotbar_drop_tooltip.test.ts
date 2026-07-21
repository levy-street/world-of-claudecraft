// Regression for a reported bug (#1485): dragging a hotbar ability onto another
// slot left the tooltip stale. A drop that ends with the cursor already inside the
// target slot fires no mouseenter, so the tooltip kept its pre-drop text (the
// "empty slot" hint, or the previous ability's name after a swap). Every sibling
// slot mutation (clearSlot, the context-menu clear, char/bags window drops) already
// calls hideTooltip() on mutate; the two hotbar drop-completion paths did not.
// Guard that both now clear the tooltip after the slot is rearranged.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
// Strip comments so the explanatory comment near the fix cannot satisfy the scan.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('hotbar drag-drop clears the stale tooltip (#1485)', () => {
  it('desktop drop calls hideTooltip after saving the rearranged slot map', () => {
    // The action-bar desktop drop handler is the block that places an item onto a
    // hotbar slot; isolate it up to the following dragend handler.
    const start = code.indexOf('placeItemOnSlot(this.hotbarActions');
    expect(start).toBeGreaterThan(-1);
    const handler = code.slice(start, code.indexOf("addEventListener('dragend'", start));
    const saveIdx = handler.indexOf('this.saveSlotMap();');
    const hideIdx = handler.indexOf('this.hideTooltip();');
    expect(saveIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(saveIdx);
  });

  it('mobile drag finish calls hideTooltip after swapping slots', () => {
    // The mobile finish handler swaps by pointer target; isolate from its swap call
    // to the clearMobileHotbarDrag teardown.
    const start = code.indexOf('resolveMobileHotbarDrop(drag.sourceIndex, targetIndex)');
    expect(start).toBeGreaterThan(-1);
    const handler = code.slice(start, code.indexOf('this.clearMobileHotbarDrag();', start));
    const saveIdx = handler.indexOf('this.saveSlotMap();');
    const hideIdx = handler.indexOf('this.hideTooltip();');
    expect(saveIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(saveIdx);
  });
});
