// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourierDispatchRequest, CourierInfo } from '../src/sim/courier/types';
import type { InvSlot } from '../src/sim/types';
import { CourierWindow } from '../src/ui/hud/courier';

afterEach(() => {
  document.body.innerHTML = '';
});
function rig() {
  const root = document.createElement('div');
  document.body.append(root);
  let bags: InvSlot[] = [{ itemId: 'linen_cloth', count: 4 }];
  const info: CourierInfo = {
    phase: 'ready',
    active: true,
    x: 0,
    z: 0,
    bankerId: 1,
    travelDistance: 0,
    remainingDistance: 0,
    inventoryRevision: 1,
    bankRevision: 1,
    cargo: [],
    withdrawals: [],
    revision: 1,
    bankSlots: [{ itemId: 'healing_potion', count: 2 }],
    bankCapacity: 24,
  };
  const deps = {
    info: () => info,
    inventory: vi.fn(() => bags),
    inventoryCapacity: vi.fn(() => 16),
    hideTooltip: vi.fn(),
    itemIcon: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    dispatch: vi.fn<(request: CourierDispatchRequest) => void>(),
    closeOthers: vi.fn(),
    captureFocus: vi.fn(() => null),
    restoreFocus: vi.fn(),
    onClosed: vi.fn(),
  };
  const window = new CourierWindow(root, deps);
  window.open();
  return {
    root,
    info,
    deps,
    window,
    replaceBags: (next: InvSlot[]) => {
      bags = next;
    },
  };
}
describe('courier window', () => {
  it('places bank and inventory sockets around the courier and retains empty bank space', () => {
    const { root } = rig();
    const columns = root.querySelector('.courier-columns')!;
    expect(columns.children[0].getAttribute('data-courier-storage')).toBe('withdrawals');
    expect(columns.children[1].classList.contains('courier-companion')).toBe(true);
    expect(columns.children[2].getAttribute('data-courier-storage')).toBe('deposits');
    expect(
      columns.querySelectorAll('[data-courier-storage="withdrawals"] .bank-item'),
    ).toHaveLength(24);
    expect(root.querySelector('.courier-portrait img')?.getAttribute('src')).toContain(
      '/ui/courier/donkey.webp',
    );
  });
  it('refreshes empty sockets when bank or bag capacity changes without moving items', () => {
    const { root, info, deps, window } = rig();
    deps.inventoryCapacity.mockReturnValue(20);
    info.bankCapacity = 30;
    window.refreshIfChanged();
    expect(root.querySelectorAll('[data-courier-storage="withdrawals"] .bank-item')).toHaveLength(
      30,
    );
    expect(root.querySelectorAll('[data-courier-storage="deposits"] .bank-item')).toHaveLength(20);
  });
  it('retains full overflow inventory and owned-item marks in the socket grid', () => {
    const { root, window, replaceBags } = rig();
    replaceBags(
      Array.from({ length: 40 }, () => ({
        itemId: 'membership_helmet',
        count: 1,
        instance: { boundTo: 1, locked: true },
      })),
    );
    window.render(true);
    expect(root.querySelectorAll('[data-courier-side="deposits"]')).toHaveLength(40);
    expect(root.querySelector('[data-courier-side="deposits"] .bi-glyph-bound')).not.toBeNull();
    expect(root.querySelector('[data-courier-side="deposits"] .bi-lock-seal')).not.toBeNull();
  });

  it('disables quest items and dispatches only the ordinary stack from mixed bags', () => {
    const { root, info, deps, window, replaceBags } = rig();
    replaceBags([
      { itemId: 'clue_scroll', count: 1 },
      { itemId: 'linen_cloth', count: 4 },
    ]);
    info.bankSlots = [{ itemId: 'clue_scroll', count: 1 }];
    window.render(true);
    const quest = root.querySelector<HTMLButtonElement>(
      '[data-courier-side="deposits"][data-courier-index="0"]',
    )!;
    expect(quest.disabled).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>('[data-courier-side="withdrawals"]')!.disabled,
    ).toBe(true);
    // Even a synthetic event bypassing the native disabled click cannot stage it.
    quest.dispatchEvent(new MouseEvent('click'));
    expect(root.querySelector<HTMLButtonElement>('.courier-send')!.disabled).toBe(true);
    root
      .querySelector<HTMLButtonElement>('[data-courier-side="deposits"][data-courier-index="1"]')!
      .click();
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.dispatch.mock.calls[0][0].deposits.map((selection) => selection.index)).toEqual([
      1,
    ]);
    expect(deps.dispatch.mock.calls[0][0].withdrawals).toEqual([]);
  });
  it('selects both directions, retains focus and sends one custody request', () => {
    const { root, deps } = rig();
    expect(document.activeElement).toBe(root.querySelector('.x-btn'));
    const deposit = root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!;
    deposit.focus();
    deposit.click();
    expect(document.activeElement?.getAttribute('data-courier-side')).toBe('deposits');
    root.querySelector<HTMLButtonElement>('[data-courier-side="withdrawals"]')!.click();
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch.mock.calls[0][0].deposits).toHaveLength(1);
    expect(deps.dispatch.mock.calls[0][0].withdrawals).toHaveLength(1);
  });
  it('keeps both storage scroll positions when selecting a stack', () => {
    const { root } = rig();
    const bankGrid = root.querySelector<HTMLElement>(
      '[data-courier-storage="withdrawals"] .courier-grid',
    )!;
    const bagGrid = root.querySelector<HTMLElement>(
      '[data-courier-storage="deposits"] .courier-grid',
    )!;
    bankGrid.scrollTop = 100;
    bagGrid.scrollTop = 60;
    root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!.click();
    expect(
      root.querySelector('[data-courier-storage="withdrawals"] .courier-grid')!.scrollTop,
    ).toBe(100);
    expect(root.querySelector('[data-courier-storage="deposits"] .courier-grid')!.scrollTop).toBe(
      60,
    );
  });
  it('checks expiry at click time and keeps saved cargo visible afterward', () => {
    const { root, info, deps, window } = rig();
    root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!.click();
    info.active = false;
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch).not.toHaveBeenCalled();
    info.phase = 'waiting';
    info.cargo = [{ itemId: 'linen_cloth', count: 4 }];
    window.refreshIfChanged();
    expect(root.querySelectorAll('.courier-cargo li')).toHaveLength(1);
    expect(root.querySelector('.courier-send')).toBeNull();
  });
  it('never retargets a stale click to replacement inventory', () => {
    const { root, deps, replaceBags } = rig();
    const old = root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!;
    replaceBags([{ itemId: 'healing_potion', count: 1 }]);
    old.click();
    expect(root.querySelector<HTMLButtonElement>('.courier-send')!.disabled).toBe(true);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
  it('does not rebuild for pose changes and restores focus on close', () => {
    const { root, info, deps, window } = rig();
    const before = root.firstChild;
    deps.inventory.mockClear();
    info.x = 10;
    window.refreshIfChanged();
    expect(root.firstChild).toBe(before);
    expect(deps.inventory).not.toHaveBeenCalled();
    window.close();
    expect(window.isOpen()).toBe(false);
    expect(deps.restoreFocus).toHaveBeenCalledOnce();
    expect(deps.onClosed).toHaveBeenCalledOnce();
  });
});
