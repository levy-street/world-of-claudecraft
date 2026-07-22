// @vitest-environment jsdom
// The instanced-slot bag marker (Professions 2.0 Phase 12d): drives the real
// BagsWindow painter against a jsdom container (the vendor_window_painter
// idiom) and pins the corner marker on the CELL itself: an instanced (per-copy
// payload) stack renders .bi-instance, a plain stack does not, and a COUNTED
// instanced stack renders the marker AND the standard count badge (badges key
// on slot.count, so the two compose). The marker markup is static (no hover,
// no graphics-tier gate), so its presence in the built DOM is the whole
// contract; the styling contract is pinned separately below against the
// stylesheet source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function fakeWorld(inventory: InvSlot[]): IWorld {
  return {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
  } as unknown as IWorld;
}

function windowFor(inventory: InvSlot[]): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => fakeWorld(inventory),
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return root;
}

describe('bags grid instanced-slot marker (Phase 12d)', () => {
  it('an instanced slot renders the corner marker; a plain slot does not', () => {
    const root = windowFor([
      { itemId: 'copper_ore', count: 1, instance: { signer: 'Anna' } },
      { itemId: 'copper_ore', count: 1 },
    ]);
    const cells = root.querySelectorAll('button.bag-item');
    expect(cells.length).toBe(2);
    expect(cells[0].querySelector('.bi-instance')).not.toBeNull();
    expect(cells[1].querySelector('.bi-instance')).toBeNull();
    // The marker is decorative for AT (the long-press/hover tooltip stays the
    // detail surface), so it must not add a phantom accessible node.
    expect(cells[0].querySelector('.bi-instance')?.getAttribute('aria-hidden')).toBe('true');
    // The per-copy flag the aria-hidden tab shows sighted players rides the
    // CELL's accessible name instead (the review's a11y arm): the instanced
    // cell uses the maker-marked label, the plain cell keeps the pre-12d one.
    expect(cells[0].getAttribute('aria-label')).toContain('maker-marked copy');
    expect(cells[1].getAttribute('aria-label')).not.toContain('maker-marked copy');
  });

  it('a counted instanced stack renders the marker AND the standard count badge', () => {
    const root = windowFor([{ itemId: 'copper_ore', count: 3, instance: { signer: 'Anna' } }]);
    const cell = root.querySelector('button.bag-item');
    expect(cell).not.toBeNull();
    expect(cell?.querySelector('.bi-instance')).not.toBeNull();
    expect(cell?.querySelector('.bi-count')?.textContent).toContain('3');
  });

  it('a plain counted stack keeps the count badge and no marker', () => {
    const root = windowFor([{ itemId: 'copper_ore', count: 5 }]);
    const cell = root.querySelector('button.bag-item');
    expect(cell?.querySelector('.bi-count')?.textContent).toContain('5');
    expect(cell?.querySelector('.bi-instance')).toBeNull();
  });
});

describe('marker stylesheet contract (source pins)', () => {
  // jsdom gives import.meta.url an http URL, which readFileSync(new URL(...))
  // rejects (the vendor_window_painter precedent): resolve from __dirname.
  const components = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
  const start = components.indexOf('.bag-item .bi-instance');
  const block = components.slice(start, components.indexOf('}', start));

  it('is styled once, from a static color token, never an --fx-* tier knob', () => {
    expect(start).toBeGreaterThan(-1);
    expect(components.indexOf('.bag-item .bi-instance', start + 1)).toBe(-1);
    expect(block).toContain('var(--color-accent)');
    expect(block).not.toContain('--fx-');
    // Always-on visibility: the marker never hides behind hover or media state.
    expect(components).not.toContain('.bag-item:hover .bi-instance');
  });
});
