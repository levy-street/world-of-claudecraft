// @vitest-environment happy-dom
//
// Space over a focused bag row must reach the game as a JUMP, never activate
// the row. The bug: summoning a mount from bags leaves that reins row focused
// (the focus-restore ladder re-seats it across the rebuild), so the next
// Space natively activated the button, re-used the reins, and "clicking the
// reins you are already riding dismounts" (src/sim/mounts.ts). The rider was
// thrown every single time they tried to hop.
//
// Two halves of the contract, both asserted here:
//   - the row cancels the default, so the browser never synthesises its click
//   - the row does NOT stop propagation, so Input's window keydown still jumps
// Enter is untouched: keyboard players still activate a row with it.

import { describe, expect, it, vi } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import { panelKeyGuardStops } from '../src/ui/panel_key_guard';
import type { IWorld } from '../src/world_api';

const REINS = 'reins_valorsteed';

function harness(inventory: InvSlot[]): {
  root: HTMLElement;
  w: BagsWindow;
  useItem: ReturnType<typeof vi.fn>;
} {
  const useItem = vi.fn();
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    useItem,
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
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
    isGuildBankTab: () => false,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  const w = new BagsWindow(deps);
  w.render();
  return { root, w, useItem };
}

function reinsRow(root: HTMLElement): HTMLElement {
  const rows = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')];
  const row = rows.find((n) => n.dataset.focusKey === `bag:${REINS}:0`);
  expect(row, 'missing the reins row').toBeTruthy();
  return row as HTMLElement;
}

/** Dispatch a real bubbling keydown from `row` and report what the game saw. */
function pressKey(row: HTMLElement, key: string, code: string) {
  let reachedWindow = false;
  const onWindow = (): void => {
    reachedWindow = true;
  };
  window.addEventListener('keydown', onWindow);
  const ev = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  row.dispatchEvent(ev);
  window.removeEventListener('keydown', onWindow);
  return { reachedWindow, defaultPrevented: ev.defaultPrevented };
}

describe('space over a focused bag row', () => {
  it('cancels the row activation so the reins are not re-used', () => {
    const { root, useItem } = harness([{ itemId: REINS, count: 1 }]);
    const row = reinsRow(root);
    row.focus();
    expect(document.activeElement, 'the row holds focus, as after a summon').toBe(row);

    const seen = pressKey(row, ' ', 'Space');
    expect(seen.defaultPrevented, 'Space must not natively activate the row').toBe(true);
    expect(useItem, 'Space must never re-use the reins').not.toHaveBeenCalled();
  });

  it('still lets Space reach the game so the mount jumps', () => {
    const { root } = harness([{ itemId: REINS, count: 1 }]);
    const row = reinsRow(root);
    row.focus();

    const seen = pressKey(row, ' ', 'Space');
    expect(seen.reachedWindow, "Space must bubble to Input's window keydown to jump").toBe(true);
  });

  it('leaves Enter activation alone for keyboard players', () => {
    const { root } = harness([{ itemId: REINS, count: 1 }]);
    const row = reinsRow(root);
    row.focus();

    const seen = pressKey(row, 'Enter', 'Enter');
    expect(seen.defaultPrevented, 'Enter still activates the row natively').toBe(false);
  });

  it('marks the row so the HUD panel guard can let Space past', () => {
    const { root } = harness([{ itemId: REINS, count: 1 }]);
    expect(reinsRow(root).hasAttribute('data-bag-item-row')).toBe(true);
  });

  // The two halves composed: the real row guard under the real #bags panel
  // guard the Hud installs. Without the bag-row exemption the panel swallowed
  // the press here and the rider could not hop with their bags open.
  it('survives the HUD #bags panel guard and still reaches the game', () => {
    const { root, useItem } = harness([{ itemId: REINS, count: 1 }]);
    const panel = document.createElement('div');
    panel.append(root);
    document.body.append(panel);
    // Byte-for-byte the listener hud.ts installs on each non-modal panel.
    panel.addEventListener('keydown', (e) => {
      if (panelKeyGuardStops(e.target as HTMLElement, e.key, e.code)) e.stopPropagation();
    });

    const row = reinsRow(root);
    row.focus();
    const seen = pressKey(row, ' ', 'Space');

    expect(seen.reachedWindow, 'the panel guard must let a bag row Space through').toBe(true);
    expect(seen.defaultPrevented, 'and it must still be a cancelled activation').toBe(true);
    expect(useItem, 'the reins must never be re-used').not.toHaveBeenCalled();
  });

  it('the same panel guard still swallows Space on an ordinary panel button', () => {
    const panel = document.createElement('div');
    const close = document.createElement('button');
    panel.append(close);
    document.body.append(panel);
    panel.addEventListener('keydown', (e) => {
      if (panelKeyGuardStops(e.target as HTMLElement, e.key, e.code)) e.stopPropagation();
    });

    close.focus();
    expect(pressKey(close, ' ', 'Space').reachedWindow, 'close button keeps the old guard').toBe(
      false,
    );
  });
});
