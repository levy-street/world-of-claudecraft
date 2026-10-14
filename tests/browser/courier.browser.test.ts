import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { CourierInfo } from '../../src/sim/courier/types';
import type { InvSlot } from '../../src/sim/types';
import { CourierWindow } from '../../src/ui/hud/courier';
import { knownItemIconHtml } from '../../src/ui/unknown_item_icon';
import { axeSeriousViolations, cleanup, host, stubDeps } from './_harness';

afterEach(async () => {
  cleanup();
  document.body.className = '';
  await page.viewport(1280, 800);
});

it.each([
  ['desktop', 1280, 800],
  ['portrait', 390, 844],
  ['landscape', 844, 390],
] as const)(
  'keeps courier sockets, selection and delivery reachable in %s',
  async (label, width, height) => {
    await page.viewport(width, height);
    document.body.className = width < 1000 ? 'mobile-touch game-active' : 'game-active';
    document.documentElement.style.setProperty('--app-width', `${width}px`);
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    document.documentElement.style.setProperty('--ui-scale', '1');
    const root = host('courier-window', 'window panel ui-window');
    const inventory: InvSlot[] = [
      { itemId: 'linen_scrap', count: 12 },
      { itemId: 'healing_potion', count: 4 },
      { itemId: 'membership_helmet', count: 1, instance: { boundTo: 1 } },
    ];
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
      bankSlots: [
        { itemId: 'healing_potion', count: 8 },
        { itemId: 'linen_scrap', count: 20 },
      ],
      bankCapacity: 24,
    };
    const dispatch = vi.fn();
    const courier = new CourierWindow(
      root,
      stubDeps({
        info: () => info,
        inventory: () => inventory,
        inventoryCapacity: () => 32,
        itemIcon: knownItemIconHtml,
        dispatch,
      }),
    );
    courier.open();
    for (const image of root.querySelectorAll('img')) await image.decode();
    const columns = root.querySelector<HTMLElement>('.courier-columns')!;
    const bank = root.querySelector<HTMLElement>('[data-courier-storage="withdrawals"]')!;
    const companion = root.querySelector<HTMLElement>('.courier-companion')!;
    const bags = root.querySelector<HTMLElement>('[data-courier-storage="deposits"]')!;
    if (width > 600) {
      expect(bank.getBoundingClientRect().right).toBeLessThan(
        companion.getBoundingClientRect().left,
      );
      expect(companion.getBoundingClientRect().right).toBeLessThan(
        bags.getBoundingClientRect().left,
      );
    } else {
      expect(bank.getBoundingClientRect().bottom).toBeLessThan(
        companion.getBoundingClientRect().top,
      );
      expect(companion.getBoundingClientRect().bottom).toBeLessThan(
        bags.getBoundingClientRect().top,
      );
    }
    expect(columns.scrollWidth).toBeLessThanOrEqual(columns.clientWidth + 1);
    expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(width + 1);
    for (const cell of root.querySelectorAll<HTMLElement>('[data-courier-side]')) {
      expect(cell.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
      expect(cell.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    }
    const firstBankItem = root.querySelector<HTMLButtonElement>(
      '[data-courier-side="withdrawals"]',
    )!;
    firstBankItem.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement?.getAttribute('data-courier-side')).toBe('withdrawals');
    expect(getComputedStyle(document.activeElement!).outlineStyle).not.toBe('none');
    root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!.click();
    expect(root.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
    if (import.meta.env.VITE_COURIER_FORCED === '1') {
      expect(matchMedia('(forced-colors: active)').matches).toBe(true);
      const selection = root.querySelector<HTMLElement>('.courier-selected')!;
      const colors = getComputedStyle(selection);
      expect(colors.color).not.toBe(colors.backgroundColor);
      expect(selection.querySelector('svg')).not.toBeNull();
    }
    const send = root.querySelector<HTMLButtonElement>('.courier-send')!;
    expect(send.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
    expect(
      root.querySelector('.courier-companion')!.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(root.querySelector('.ui-win-foot')!.getBoundingClientRect().top);
    expect(await axeSeriousViolations(root)).toEqual([]);
    if (import.meta.env.VITE_COURIER_CAPTURE === '1')
      await page.screenshot({
        path: `../../docs/screenshots/membership-courier/refined-${label}.png`,
      });
    send.click();
    expect(dispatch).toHaveBeenCalledOnce();
  },
);
