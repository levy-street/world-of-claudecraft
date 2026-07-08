// Regression for a reported bug (#1626): dragging a bag item on top of another
// left the tooltip stale. A drag that ends over another bag item is rejected (bag
// rows are not drop targets), so no drop handler clears the tooltip and no fresh
// mouseenter fires on the item under the now-stationary cursor; the dragged item's
// tooltip stayed pinned (mousemove only repositions it). This is the bags twin of
// the hotbar fix (#1485), which added hideTooltip() to the drop-completion paths.
// Guard that the bag row's dragend handler now clears the tooltip after teardown.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/bags_window.ts', import.meta.url), 'utf8');
// Strip comments so the explanatory comment near the fix cannot satisfy the scan.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('bag drag-drop clears the stale tooltip (#1626)', () => {
  it('the bag row dragend handler calls hideTooltip after clearing the drag state', () => {
    // There is exactly one dragend handler on a bag row; isolate it up to the
    // attachTooltip wiring that immediately follows the draggable block.
    const start = code.indexOf("addEventListener('dragend'");
    expect(start).toBeGreaterThan(-1);
    const handler = code.slice(start, code.indexOf('attachTooltip', start));
    const clearIdx = handler.indexOf('this.deps.clearActionDropTargets();');
    const hideIdx = handler.indexOf('this.deps.hideTooltip();');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(clearIdx);
  });
});
