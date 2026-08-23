// Regression for a reported bug (#1485): dragging a hotbar ability onto another
// slot left the tooltip stale. A drop that ends with the cursor already inside the
// target slot fires no mouseenter, so the tooltip kept its pre-drop text (the
// "empty slot" hint, or the previous ability's name after a swap). Every sibling
// slot mutation (clearSlot, the context-menu clear, char/bags window drops) already
// calls hideTooltip() on mutate; the two hotbar drop-completion paths did not.
// Guard that every live slot mutation clears the tooltip after the rearrange.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hudSrc = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
// Strip comments so the explanatory comment near the fix cannot satisfy the scan.
const code = hudSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const editorSrc = readFileSync(
  new URL('../src/ui/hud/action_bar/bar_editor/bar_editor_window.ts', import.meta.url),
  'utf8',
);
const editorCode = editorSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const tapCellStart = editorCode.indexOf('private tapCell(cell: BarEditorCell): void {');
const tapCellEnd = editorCode.indexOf('private paint(): void {', tapCellStart);
const tapCellBody = editorCode.slice(tapCellStart, tapCellEnd);

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

  // The touch arm of #1485 moved with the gesture that caused it. The mobile
  // long-press rearrange is retired (it reached only the four visible ring
  // centres and armed underneath the radial); the bar editor's tapCell is the
  // touch binding path now, and it dispatches the mutation, THEN calls one
  // shared deps.hideTooltip() for the place/swap/clear kinds. Pin each mutation
  // kind individually so a future kind cannot be added to the dispatch without
  // also being added to the shared hide.
  it('the bar editor place clears the stale tooltip after the mutation', () => {
    expect(tapCellStart).toBeGreaterThan(-1);
    const placeIdx = tapCellBody.indexOf('this.deps.placeAbility(tap.abilityId, tap.slot);');
    const hideIdx = tapCellBody.indexOf('this.deps.hideTooltip();');
    expect(placeIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(placeIdx);
  });

  it('the bar editor swap clears the stale tooltip after the mutation', () => {
    expect(tapCellStart).toBeGreaterThan(-1);
    const swapIdx = tapCellBody.indexOf('this.deps.swapSlots(tap.from, tap.to);');
    const hideIdx = tapCellBody.indexOf('this.deps.hideTooltip();');
    expect(swapIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(swapIdx);
  });

  // The old shape missed this arm: clear went through a THIRD, separate path
  // that never called hideTooltip. bar_editor_window.ts's shared hide call
  // after the dispatch is what closes that gap.
  it('the bar editor clear clears the stale tooltip after the mutation', () => {
    expect(tapCellStart).toBeGreaterThan(-1);
    const clearIdx = tapCellBody.indexOf('this.deps.clearSlot(tap.slot);');
    const hideIdx = tapCellBody.indexOf('this.deps.hideTooltip();');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(clearIdx);
  });

  it('leaves no long-press rearrange path behind to reintroduce the bug', () => {
    expect(code).not.toContain('mobileHotbarDrag');
    expect(code).not.toContain('resolveMobileHotbarDrop');
  });

  // The three arms above only pin RELATIVE ordering inside tapCell, which a
  // narrowed guard cannot fail (see tests/bar_editor_window.test.ts for the
  // behavioral pin that closes that gap). This pins the guard's own literal
  // membership, so dropping any one kind from the condition fails here too.
  it('pins the shared-hide guard membership: place, swap, and clear, and no other kind', () => {
    expect(editorCode).toContain(
      "if (tap.kind === 'place' || tap.kind === 'swap' || tap.kind === 'clear') {",
    );
  });
});
