import { afterEach, describe, expect, it, vi } from 'vitest';
import { BagsWindow } from '../../src/ui/bags_window';
import { t } from '../../src/ui/i18n';
import { cleanup, host, stubDeps } from './_harness';

afterEach(() => {
  cleanup();
  document.body.className = '';
  localStorage.removeItem('woc_bag_filter');
});

describe('mobile Bags filter and item action menu', () => {
  it('keeps a delayed desktop item tooltip hidden while the mobile action menu is open', async () => {
    document.body.classList.add('mobile-touch');
    const root = host('bags');
    const tooltip = document.createElement('div');
    tooltip.id = 'tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
    const slot = { itemId: 'elixir_of_the_bear', count: 1 };
    const useItem = vi.fn();
    const world = {
      inventory: [slot],
      copper: 0,
      bags: [null, null, null, null],
      bagCapacity: 20,
      useItem,
    };
    const tooltipDriver: { show?: () => void } = {};
    let focusRestores = 0;
    const hideTooltip = () => {
      tooltip.style.display = 'none';
    };
    const win = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => world as never,
        wocBalanceHtml: () => '',
        moneyHtml: () => '',
        itemIcon: () => '',
        itemTooltip: () => '<div class="tt-desc">Increases Stamina by 12.</div>',
        attachTooltip: (element, html, enabled) => {
          if (!element.classList.contains('bag-item')) return;
          tooltipDriver.show = () => {
            if (enabled && !enabled()) {
              hideTooltip();
              return;
            }
            tooltip.innerHTML = html();
            tooltip.style.display = 'block';
          };
        },
        hideTooltip,
        consumableLayout: () => null,
        consumablesCustom: () => false,
        captureFocus: () => null,
        restoreFocus: (target: HTMLElement | null) => {
          focusRestores++;
          // FocusManager.restore() deliberately settles focus on the next task so
          // it wins over the closing click. Reproduce that shipped lifecycle.
          window.setTimeout(() => {
            target?.focus();
            tooltipDriver.show?.();
          }, 0);
        },
      }),
    );

    win.render();
    expect(tooltipDriver.show).toBeTypeOf('function');
    tooltipDriver.show?.();
    expect(tooltip.style.display).toBe('block');

    root.querySelector<HTMLButtonElement>('.bag-item')?.click();
    expect(root.querySelector('.bag-item-action-menu')).toBeTruthy();
    expect(tooltip.style.display).toBe('none');

    // Models a focus/long-press callback that was already queued by the shared
    // desktop tooltip helper before the tap opened the mobile action sheet.
    tooltipDriver.show?.();
    expect(tooltip.style.display).toBe('none');

    root.querySelector<HTMLButtonElement>('.bag-item-action-close')?.click();
    expect(focusRestores).toBe(1);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(tooltip.style.display).toBe('none');
    tooltipDriver.show?.();
    expect(tooltip.style.display).toBe('block');

    hideTooltip();
    root.querySelector<HTMLButtonElement>('.bag-item')?.click();
    root.querySelector<HTMLButtonElement>('[data-action="use"]')?.click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(useItem).toHaveBeenCalledWith(slot.itemId);
    expect(focusRestores).toBe(2);
    expect(tooltip.style.display).toBe('none');
    tooltipDriver.show?.();
    expect(tooltip.style.display).toBe('block');
  });

  it('does not reopen the dismissed item action menu when a category filter renders', () => {
    localStorage.removeItem('woc_bag_filter');
    document.body.classList.add('mobile-touch');
    const root = host('bags');
    const slot = { itemId: 'elixir_of_the_bear', count: 1 };
    const world = {
      inventory: [slot],
      copper: 0,
      bags: [null, null, null, null],
      bagCapacity: 20,
    };
    const win = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => world as never,
        wocBalanceHtml: () => '',
        moneyHtml: () => '',
        itemIcon: () => '',
        itemTooltip: () => '<div class="tt-desc">Increases Stamina by 12.</div>',
        consumableLayout: () => null,
        consumablesCustom: () => false,
        captureFocus: () => null,
        restoreFocus: (target: HTMLElement | null) => target?.focus(),
      }),
    );

    win.render();
    root.querySelector<HTMLButtonElement>('.bag-item')?.click();
    expect(root.querySelector('.bag-item-action-menu')).toBeTruthy();

    root.querySelector<HTMLButtonElement>('.bag-item-action-close')?.click();
    expect(root.querySelector('.bag-item-action-menu')).toBeNull();

    const consumables = Array.from(root.querySelectorAll<HTMLButtonElement>('.bag-chip')).find(
      (chip) => chip.textContent === t('hudChrome.bags.filterConsumable'),
    );
    expect(consumables).toBeTruthy();
    consumables?.click();

    expect(root.querySelector('.bag-item-action-menu')).toBeNull();
    expect(
      Array.from(root.querySelectorAll<HTMLButtonElement>('.bag-chip'))
        .find((chip) => chip.textContent === t('hudChrome.bags.filterConsumable'))
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
