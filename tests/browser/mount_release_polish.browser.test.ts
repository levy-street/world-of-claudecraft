// The actual entry markup and shipped CSS must keep the two launcher columns
// balanced after new features add buttons. Static height budgets missed this.
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import indexHtml from '../../index.html?raw';
import playHtml from '../../play.html?raw';
import { storeMountsSectionHtml } from '../../src/ui/store_mount_card_view';
import { hydrateIcons } from '../../src/ui/ui_icons';
import { buildStoreMountRows } from '../../src/ui/woc_store_view';
import { cleanup } from './_harness';

afterEach(() => {
  cleanup();
  document.body.classList.remove('mobile-touch', 'xhb-mode', 'menu-rail-horizontal');
});

async function rail(entry: string) {
  const parsed = new DOMParser().parseFromString(
    entry === 'index.html' ? indexHtml : playHtml,
    'text/html',
  );
  const root = parsed
    .querySelector<HTMLTemplateElement>('#game-ui-template')!
    .content.querySelector<HTMLElement>('#side-buttons')!;
  document.body.append(document.importNode(root, true));
  const live = document.querySelector<HTMLElement>('#side-buttons')!;
  // Discord is shown by the normal desktop bootstrap on enabled builds.
  live.querySelector<HTMLButtonElement>('#mm-discord')!.hidden = false;
  live.querySelector<HTMLButtonElement>('#daily-rewards-button')!.innerHTML =
    '<img class="daily-rewards-icon" src="/ui/daily-rewards/treasure_chest.webp" alt="" draggable="false">';
  hydrateIcons(live);
  return live;
}

function bounds(root: HTMLElement) {
  return ['a', 'b'].map((id) =>
    root.querySelector<HTMLElement>(`#side-buttons-col-${id}`)!.getBoundingClientRect(),
  );
}

describe.each(['index.html', 'play.html'])('%s release UI', (entry) => {
  it('keeps desktop columns within one button row and all controls onscreen', async () => {
    await page.viewport(1280, 720);
    const root = await rail(entry);
    const store = document.createElement('div');
    store.className = 'panel';
    store.style.cssText = 'width: 1000px; padding: 16px';
    store.innerHTML = storeMountsSectionHtml(
      buildStoreMountRows(
        10000,
        [
          ...[
            'mech_bird',
            'chimeglass_tortoise',
            'rickshaw_mount',
            'goblin_rocket_sled',
            'rallycart_rxt',
          ].map((itemId) => ({
            itemId,
            name: itemId,
            kind: 'skin' as const,
            costClaudium: 2000,
            owned: false,
          })),
        ],
        [],
      ),
    );
    document.body.append(store);
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await page.screenshot({
      path: `../../docs/screenshots/cosmetics-window/v042-polish/${entry}-desktop.png`,
    });
    const [a, b] = bounds(root);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(38);
    expect(Math.min(a.top, b.top)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(a.bottom - b.bottom)).toBeLessThan(1);
    expect(store.querySelectorAll('.store-mounts')).toHaveLength(1);
    expect(store.querySelectorAll('.armory-card.rarity-epic')).toHaveLength(5);
  });

  it('keeps compact, horizontal and mobile pad layouts reachable', async () => {
    await page.viewport(844, 390);
    const root = await rail(entry);
    for (const classes of [[], ['menu-rail-horizontal'], ['mobile-touch', 'xhb-mode']]) {
      const height = classes.includes('mobile-touch') ? 390 : 600;
      await page.viewport(844, height);
      document.body.classList.remove('mobile-touch', 'xhb-mode', 'menu-rail-horizontal');
      document.body.classList.add(...classes);
      for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
        if (getComputedStyle(button).display === 'none') continue;
        const rect = button.getBoundingClientRect();
        expect(rect.top, button.id).toBeGreaterThanOrEqual(0);
        expect(rect.bottom, button.id).toBeLessThanOrEqual(height);
        expect(rect.left, button.id).toBeGreaterThanOrEqual(0);
        expect(rect.right, button.id).toBeLessThanOrEqual(844);
      }
    }
    await page.screenshot({
      path: `../../docs/screenshots/cosmetics-window/v042-polish/${entry}-mobile-pad.png`,
    });
    document.body.classList.remove('xhb-mode');
    expect(getComputedStyle(root).display).toBe('none');
  });
});
