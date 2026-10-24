import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { InvSlot } from '../../src/sim/types';
import { BagsWindow } from '../../src/ui/bags_window';
import { t } from '../../src/ui/i18n';
import { ItemDragState } from '../../src/ui/item_drag_state';
import { knownItemIconHtml } from '../../src/ui/unknown_item_icon';
import type { IWorld } from '../../src/world_api';
import { cleanup, host, stubDeps } from './_harness';

afterEach(async () => {
  cleanup();
  document.body.className = '';
  localStorage.removeItem('woc_bag_filter');
  await page.viewport(1280, 800);
});

it.each([
  ['desktop', 1280, 800, true],
  ['desktop', 1280, 800, false],
  ['portrait', 390, 844, true],
  ['portrait', 390, 844, false],
] as const)(
  'keeps the membership socket and overflow visible in %s (%i × %i, active=%s)',
  async (layout, width, height, active) => {
    await page.viewport(width, height);
    document.body.className = width < 1000 ? 'mobile-touch game-active' : 'game-active';
    document.documentElement.style.setProperty('--app-width', `${width}px`);
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    document.documentElement.style.setProperty('--ui-scale', '1');
    localStorage.removeItem('woc_bag_filter');
    const inventory: InvSlot[] = Array.from({ length: 24 }, (_, index) => ({
      itemId: index % 2 ? 'linen_scrap' : 'healing_potion',
      count: index + 1,
    }));
    // The real wire shape retains every carried stack when membership expires,
    // while hiding the inactive fifth bag and reducing usable capacity.
    const world = {
      inventory,
      bags: active ? [null, null, null, null, null] : [null, null, null, null],
      bagCapacity: 16,
      copper: 0,
      player: { cooldowns: new Map() },
    } as unknown as IWorld;
    const root = host('bags', 'window panel ui-window');
    root.style.display = 'flex';
    const tooltips = new Map<HTMLElement, () => string>();
    const window = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => world,
        dragState: new ItemDragState(),
        itemIcon: knownItemIconHtml,
        itemTooltip: () => '',
        moneyHtml: () => '',
        wocBalanceHtml: () => '',
        claudiumLauncherHtml: () => '',
        attachTooltip: (element, html) => tooltips.set(element, html),
        isTouchHud: () => width < 1000,
      }),
    );
    window.render();
    const emptyMember = root.querySelector<HTMLButtonElement>('.membership-bag-slot')!;
    expect(emptyMember.getAttribute('aria-label')).toBe(
      t(active ? 'hudChrome.bags.membershipSlot' : 'hudChrome.bags.membershipSlotLocked'),
    );
    if (active) {
      world.bags[4] = 'linen_pouch';
      Object.assign(world, { bagCapacity: 22 });
      window.render();
    }
    for (const image of root.querySelectorAll('img')) await image.decode();
    const member = root.querySelector<HTMLButtonElement>('.membership-bag-slot')!;
    const bar = root.querySelector<HTMLElement>('.bag-bar')!;
    expect(root.querySelectorAll('.bag-socket')).toHaveLength(6);
    expect(member.classList.contains('membership-locked')).toBe(!active);
    expect(member.getAttribute('aria-disabled')).toBe(active ? null : 'true');
    expect(tooltips.get(member)!()).toContain(t('hudChrome.bags.membershipSlot'));
    expect(member.getAttribute('aria-label')).toBeTruthy();
    member.focus();
    expect(document.activeElement).toBe(member);
    expect(getComputedStyle(member).outlineStyle).not.toBe('none');
    const bounds = member.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThanOrEqual(40);
    expect(bounds.height).toBeGreaterThanOrEqual(40);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(height);
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth + 1);
    expect(root.querySelectorAll('.bag-grid button.bag-item')).toHaveLength(inventory.length);
    expect(root.querySelector('.bag-capacity.over')).not.toBeNull();
    expect(root.querySelector('.bag-grid [data-bag-index="23"]')).not.toBeNull();
    expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(width + 1);
    if (import.meta.env.VITE_MEMBERSHIP_BAGS_CAPTURE === '1') {
      await page.screenshot({
        path: `../../docs/screenshots/membership/refined-bags-${active ? 'active' : 'locked'}-${layout}.png`,
      });
    }
  },
);
