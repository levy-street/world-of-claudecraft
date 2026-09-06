// @vitest-environment happy-dom
// Issue #3795: with a materials-only satchel equipped the bag window must show
// which free squares an ITEM can still take and which only a material can.
// The counter names both pools inline (not only in its tooltip), and the
// trailing empty squares beyond the general pool's headroom are painted as
// materials-only cells with their own tooltip.
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { materialsOnlyEmptyCells } from '../src/ui/bags_view';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

const HAVERSACK = 'foragers_haversack'; // 12-slot materialsOnly satchel
const gear = (n: number): InvSlot[] =>
  Array.from({ length: n }, () => ({ itemId: 'worn_sword', count: 1 }));
const mats = (n: number): InvSlot[] =>
  Array.from({ length: n }, () => ({ itemId: 'iron_ore', count: 1 }));

function render(
  bags: (string | null)[],
  inventory: InvSlot[],
  bagCapacity: number,
): { root: HTMLElement; tooltips: { el: HTMLElement; html: () => string }[] } {
  document.body.innerHTML = '';
  const world = { inventory, bags, bagCapacity, copper: 0 } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const tooltips: { el: HTMLElement; html: () => string }[] = [];
  const deps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: (el: HTMLElement, html: () => string) => tooltips.push({ el, html }),
    root: () => root,
    world: () => world,
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
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    confirmVendorSell: () => true,
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
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  } as unknown as BagsWindowDeps;
  new BagsWindow(deps).render();
  return { root, tooltips };
}

describe('materialsOnlyEmptyCells (the pure count)', () => {
  it('is zero without a materials pool, whatever is free', () => {
    expect(materialsOnlyEmptyCells([null, null, null, null], gear(3), 13)).toBe(0);
  });
  it('is the empties past the general headroom', () => {
    // general 16 with 10 gear: 6 general free; 12 materials free; 18 empty.
    expect(materialsOnlyEmptyCells([HAVERSACK, null, null, null], gear(10), 18)).toBe(12);
    // general full: every empty square is materials-only.
    expect(materialsOnlyEmptyCells([HAVERSACK, null, null, null], gear(16), 12)).toBe(12);
    // materials spill into general once the satchel is full: 16 mats + 4 gear
    // packs 12 into the satchel and 8 into general, so 8 general free.
    expect(
      materialsOnlyEmptyCells([HAVERSACK, null, null, null], [...mats(16), ...gear(4)], 8),
    ).toBe(0);
  });
  it('never exceeds the empties on screen (tolerated over-capacity)', () => {
    expect(materialsOnlyEmptyCells([HAVERSACK, null, null, null], gear(20), 0)).toBe(0);
  });
});

describe('the bag window distinguishes materials-only squares (issue #3795)', () => {
  it('names both pools inline on the counter when a satchel is equipped', () => {
    const { root } = render([HAVERSACK, null, null, null], [...gear(16), ...mats(1)], 28);
    const counter = root.querySelector('.bag-capacity');
    expect(counter?.textContent).toBe('Items 16/16, Materials 1/12');
    // The general pool is what refuses an item pickup: it wears the full mark.
    expect(counter?.classList.contains('general-full')).toBe(true);
  });

  it('keeps the plain summed counter without a satchel', () => {
    const { root } = render([null, null, null, null], gear(3), 16);
    expect(root.querySelector('.bag-capacity')?.textContent).toBe('3/16');
    expect(root.querySelectorAll('.bag-item.empty.materials-only')).toHaveLength(0);
  });

  it('paints the trailing empties past the general headroom as materials-only', () => {
    // 16 general (10 used, 6 free) + 12 materials (0 used): 18 empties, of
    // which the LAST 12 are materials-only and the first 6 plain.
    const { root, tooltips } = render([HAVERSACK, null, null, null], gear(10), 28);
    const empties = [...root.querySelectorAll<HTMLElement>('.bag-item.empty')];
    expect(empties).toHaveLength(18);
    expect(empties.slice(0, 6).every((el) => !el.classList.contains('materials-only'))).toBe(true);
    expect(empties.slice(6).every((el) => el.classList.contains('materials-only'))).toBe(true);
    const tip = tooltips.find((entry) => entry.el === empties[17]);
    expect(tip?.html()).toContain('Materials only');
    expect(tooltips.some((entry) => entry.el === empties[0])).toBe(false);
  });

  it('with the general pool full every empty square is materials-only', () => {
    const { root } = render([HAVERSACK, null, null, null], gear(16), 28);
    const empties = root.querySelectorAll('.bag-item.empty');
    expect(empties).toHaveLength(12);
    expect(root.querySelectorAll('.bag-item.empty.materials-only')).toHaveLength(12);
  });
});
