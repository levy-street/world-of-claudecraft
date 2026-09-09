import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import indexHtml from '../../index.html?raw';
import playHtml from '../../play.html?raw';
import { hydrateIcons } from '../../src/ui/ui_icons';
import { cleanup } from './_harness';

afterEach(() => {
  cleanup();
  document.body.classList.remove('mobile-touch', 'xhb-mode', 'menu-rail-horizontal');
});

describe.each([
  ['index', indexHtml],
  ['play', playHtml],
])('%s rewards sidebar', (entry, html) => {
  it.each([
    ['desktop', 1280, 720, ''],
    ['compact', 844, 600, ''],
    ['horizontal', 1280, 720, 'menu-rail-horizontal'],
    ['horizontal-compact', 844, 600, 'menu-rail-horizontal'],
  ] as const)(
    'contains the chest in its menu slot: %s',
    async (layout, width, height, bodyClass) => {
      await page.viewport(width, height);
      if (bodyClass) document.body.classList.add(bodyClass);
      const template = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector<HTMLTemplateElement>('#game-ui-template')!;
      document.body.append(
        document.importNode(template.content.querySelector('#side-buttons')!, true),
      );
      const chest = document.querySelector<HTMLButtonElement>('#daily-rewards-button')!;
      chest.innerHTML =
        '<img class="daily-rewards-icon" src="/ui/daily-rewards/treasure_chest.webp" alt="">';
      document.querySelector<HTMLButtonElement>('#mm-discord')!.hidden = false;
      hydrateIcons(document.body);
      await Promise.all([...document.images].map((img) => img.decode()));

      // Optional local evidence capture; assertions also run for before shots.
      const capture = import.meta.env.VITE_REWARDS_CAPTURE;
      if (capture === 'before' || capture === 'after') {
        await page.screenshot({
          path: `../../docs/screenshots/cosmetics-window/rewards-sidebar/${capture}-${entry}-${layout}.png`,
        });
      }

      const slot = chest.getBoundingClientRect();
      const next = document.querySelector('#mm-cosmetics')!.getBoundingClientRect();
      const icon = chest.querySelector('img')!.getBoundingClientRect();
      expect(slot.width).toBe(next.width);
      expect(slot.height).toBe(next.height);
      expect(icon.left).toBeGreaterThanOrEqual(slot.left);
      expect(icon.right).toBeLessThanOrEqual(slot.right);
      expect(icon.top).toBeGreaterThanOrEqual(slot.top);
      expect(icon.bottom).toBeLessThanOrEqual(slot.bottom);
      if (bodyClass) {
        expect(slot.bottom).toBe(next.bottom);
        expect(next.left - slot.right).toBe(0);
      } else {
        const gap = Number.parseFloat(getComputedStyle(chest.parentElement!).gap);
        expect(next.top - slot.bottom).toBe(gap);
      }
      expect(slot.left).toBeGreaterThanOrEqual(0);
      expect(slot.top).toBeGreaterThanOrEqual(0);
      expect(slot.right).toBeLessThanOrEqual(width);
      expect(slot.bottom).toBeLessThanOrEqual(height);

      const idleBorder = getComputedStyle(chest).borderTopColor;
      chest.classList.add('spin-ready');
      expect(getComputedStyle(chest).borderTopColor).not.toBe(idleBorder);
      chest.focus();
      expect(document.activeElement).toBe(chest);
      expect(getComputedStyle(chest).outlineStyle).not.toBe('none');
      expect(chest.getBoundingClientRect().toJSON()).toEqual(slot.toJSON());
      await page.elementLocator(chest).hover();
      expect(getComputedStyle(chest, '::before').content).toBe(
        JSON.stringify(chest.getAttribute('aria-label')),
      );
      await expect
        .poll(() => Number.parseFloat(getComputedStyle(chest, '::before').maxWidth))
        .toBeGreaterThan(0);
      document.body.classList.add('mobile-touch');
      expect(getComputedStyle(chest).display).toBe('none');
      document.body.classList.add('xhb-mode');
      expect(getComputedStyle(chest).display).toBe('none');
    },
  );
});
