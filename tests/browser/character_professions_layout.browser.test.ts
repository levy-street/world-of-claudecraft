import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { CRAFT_RING, GATHERING_PROFESSION_IDS } from '../../src/sim/content/professions';
import { CharWindow } from '../../src/ui/char_window';
import { ItemDragState } from '../../src/ui/item_drag_state';
import { cleanup, host, stubDeps } from './_harness';

afterEach(() => {
  cleanup();
  document.body.className = '';
  for (const key of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(key);
});

describe('Character professions spacious layout', () => {
  it.each([
    { width: 1920, height: 1080, mobile: false },
    { width: 1366, height: 768, mobile: false },
    { width: 390, height: 844, mobile: true },
    { width: 844, height: 390, mobile: true },
  ])('keeps every skill legible and reachable at $width x $height', async (size) => {
    await page.viewport(size.width, size.height);
    document.body.className = size.mobile ? 'game-active mobile-touch' : 'game-active';
    document.documentElement.style.setProperty('--app-vw', `${size.width}px`);
    document.documentElement.style.setProperty('--app-vh', `${size.height}px`);
    document.documentElement.style.setProperty('--ui-scale', '1');
    const root = host('char-window');
    root.style.display = 'none';
    const launcher = document.createElement('button');
    launcher.id = 'mm-professions';
    const openCrafting = vi.fn();
    launcher.addEventListener('click', openCrafting);
    document.body.appendChild(launcher);
    const win = new CharWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            cfg: { playerClass: 'warrior' },
            player: { name: 'Aurelia', level: 60, skin: 0 },
            equipment: {},
            honor: 1200,
            archetypeTitle: null,
            hobbyCraft: null,
            craftingIdentity: {
              craftSkills: Object.fromEntries(CRAFT_RING.map((craft) => [craft.id, 125])),
            },
            professionsState: {
              skills: GATHERING_PROFESSION_IDS.map((professionId) => ({
                professionId,
                skill: 75,
                maxSkill: 125,
              })),
            },
          }) as never,
        statCellHtml: () => '',
        statTooltipHtml: () => '',
        slotName: (slot) => slot,
        captureFocus: () => null,
        dragState: new ItemDragState(),
      }),
    );
    win.toggle();
    root.querySelector<HTMLButtonElement>('[data-tab="skills"]')!.click();
    await document.fonts.ready;
    const panel = root.querySelector<HTMLElement>('.char-tab-panel')!;
    const cards = root.querySelectorAll<HTMLElement>('.char-skill-row');
    expect(cards).toHaveLength(CRAFT_RING.length + GATHERING_PROFESSION_IDS.length);
    expect.soft(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    expect.soft(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    if (!size.mobile) {
      expect
        .soft(panel.scrollHeight, 'desktop tab scroll')
        .toBeLessThanOrEqual(panel.clientHeight + 1);
      expect
        .soft(root.scrollHeight, 'desktop window scroll')
        .toBeLessThanOrEqual(root.clientHeight + 1);
    }
    for (const card of cards) {
      const name = card.querySelector<HTMLElement>('.char-skill-copy > span')!;
      const icon = card.querySelector<HTMLImageElement>('img')!;
      expect
        .soft(parseFloat(getComputedStyle(name).fontSize), name.textContent!)
        .toBeGreaterThanOrEqual(14);
      expect.soft(name.scrollWidth, name.textContent!).toBeLessThanOrEqual(name.clientWidth + 1);
      expect.soft(icon.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
      expect.soft(card.querySelector('b')!.textContent).toMatch(/\d+\s*\/\s*\d+/);
      const progress = card.querySelector('[role="progressbar"]')!;
      expect(progress.getAttribute('aria-label')).toBe(name.textContent);
      expect(progress.getAttribute('aria-valuemin')).toBe('0');
      const [value, maximum] = card.querySelector('b')!.textContent!.split('/').map(Number);
      expect(Number(progress.getAttribute('aria-valuemax'))).toBe(maximum);
      expect(Number(progress.getAttribute('aria-valuenow'))).toBe(Math.min(value, maximum));
    }
    const button = root.querySelector<HTMLButtonElement>('[data-act="open-professions"]')!;
    for (const node of [...cards, button]) {
      if (size.mobile) node.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = node.getBoundingClientRect();
      expect.soft(rect.left).toBeGreaterThanOrEqual(0);
      expect.soft(rect.right).toBeLessThanOrEqual(size.width + 1);
      expect.soft(rect.top).toBeGreaterThanOrEqual(0);
      expect.soft(rect.bottom).toBeLessThanOrEqual(size.height + 1);
      if (!size.mobile)
        expect
          .soft(rect.bottom)
          .toBeLessThanOrEqual(root.querySelector('.char-footer')!.getBoundingClientRect().top + 1);
    }
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    button.click();
    expect(openCrafting).toHaveBeenCalledOnce();
  });
});
