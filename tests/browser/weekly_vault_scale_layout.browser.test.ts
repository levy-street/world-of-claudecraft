// The Weekly Vault sheet's fit to the screen, measured in a REAL browser.
//
// The bug: on a wide desktop the vault takes over #bank-window with a
// near-full-screen box, but that rule sized it in raw vw/vh. #bank-window
// lives inside #ui, which carries `zoom: var(--ui-scale)`, so at any UI scale
// above 1 the zoom re-multiplied the box and the vault ran off the right and
// bottom of the screen. The fix divides every viewport length by
// --window-scale, as the base vault rule (and the shared .window clamp)
// already did; the Dungeon Finder's read-only vault had the same raw-vh bug.
// Two follow-ons are pinned here too: on a short screen at a high UI scale
// the track grid keeps a floor (the vault art is sized from its height) and
// the panel scrolls, so the "View possible loot" button must ride the status
// line in flow rather than float at a fixed offset over scrolling content.
//
// jsdom and happy-dom implement no layout and no zoom, so only a real browser
// can see any of this. Viewport recipe: tests/browser/window_resize_fill.

import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { emptyWeeklyRewards } from '../../src/sim/weekly_rewards';
import type { PainterHostPresentation } from '../../src/ui/painter_host';
import { WeeklyRewardsTab } from '../../src/ui/weekly_rewards_window';
import type { IWorld } from '../../src/world_api';
import { cleanup } from './_harness';

// Sub-pixel slack for the zoom's rounding; the regression overshot by hundreds.
const SLACK = 1;
// The smallest vault illustration (CSS px on screen) the sheet may paint.
const MIN_ART = 100;

let pane: WeeklyRewardsTab | null = null;

async function mountVault(
  width: number,
  height: number,
  uiScale: number,
  host: 'bank' | 'dungeon-finder' = 'bank',
): Promise<HTMLElement> {
  await page.viewport(width, height);
  const root = document.documentElement.style;
  root.setProperty('--app-vw', `${width}px`);
  root.setProperty('--app-vh', `${height}px`);
  root.setProperty('--ui-scale', String(uiScale));
  const ui = document.createElement('div');
  ui.id = 'ui';
  const win = document.createElement('div');
  win.className = 'window panel ui-window';
  win.style.display = 'flex';
  // The title row bank_window.ts / dungeon_finder_window.ts paint above the pane.
  win.innerHTML =
    '<div class="panel-title ui-win-head"><span class="ui-win-title">The Weekly Vault</span></div>';
  if (host === 'bank') {
    document.body.classList.add('weekly-vault-open');
    win.id = 'bank-window';
  } else {
    win.id = 'dungeon-finder-window';
    win.classList.add('df-vault-mode');
  }
  ui.appendChild(win);
  document.body.appendChild(ui);

  const state = emptyWeeklyRewards(604800000);
  state.world = 8;
  pane = new WeeklyRewardsTab(
    {
      world: () =>
        ({
          cfg: { playerClass: 'mage' },
          weeklyRewardInfo: {
            state,
            nowMs: 1000,
            playerLevel: 20,
            canClaim: true,
            worldQuestsAvailable: true,
            readyWeeks: 0,
          },
        }) as IWorld,
      presentation: {
        itemIcon: () => '',
        attachTooltip: () => undefined,
      } as unknown as PainterHostPresentation,
      onInventoryChanged: () => undefined,
    },
    { readOnly: host !== 'bank' },
  );
  pane.renderInto(win);
  return win;
}

function part(win: HTMLElement, selector: string): HTMLElement {
  const el = win.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  return el as HTMLElement;
}

afterEach(() => {
  pane?.close();
  pane = null;
  cleanup();
  document.body.classList.remove('weekly-vault-open');
  for (const prop of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(prop);
});

describe('weekly vault sheet scales with the screen', () => {
  it.each([
    [1920, 1080, 0.75],
    [1920, 1080, 1],
    [1920, 1080, 1.25],
    [1920, 1080, 1.5],
    [2560, 1440, 1],
    [2560, 1440, 2],
    [1280, 720, 1.25],
  ])('at %ix%i and UI scale %s the vault stays fully on screen', async (w, h, scale) => {
    const win = await mountVault(w, h, scale);
    const box = win.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(-SLACK);
    expect(box.right).toBeLessThanOrEqual(w + SLACK);
    expect(box.bottom).toBeLessThanOrEqual(h + SLACK);
    // Still the near-full-screen sheet, not merely clamped small: 96% of the
    // width at every scale, and 96% of the height until the 1080px author cap,
    // which then centres vertically.
    const expectedHeight = Math.min(h * 0.96, 1080 * scale);
    expect(box.width).toBeCloseTo(w * 0.96, 0);
    expect(box.height).toBeCloseTo(expectedHeight, 0);
    expect(box.top).toBeCloseTo(Math.max(h * 0.02, (h - 1080 * scale) / 2), 0);
  });

  it('keeps every vault legible on a short screen at a high UI scale', async () => {
    // 1366x768 passes the desktop sheet gate, but at UI scale 1.5 the zoomed
    // space is only ~911x512 author px.
    const win = await mountVault(1366, 768, 1.5);
    const tiles = [...win.querySelectorAll<HTMLElement>('.weekly-tracks .weekly-milestone')];
    expect(tiles.length).toBe(12);
    for (const tile of tiles) {
      const art = part(tile, '.weekly-vault-illustration').getBoundingClientRect();
      // The painted vault is the square the contained image fills.
      expect(Math.min(art.width, art.height)).toBeGreaterThanOrEqual(MIN_ART);
      // Wrapped labels (these narrow tiles wrap the locked "Unlocks 1
      // loot-table roll" footer) take room from the art, never draw over it.
      expect(art.top).toBeGreaterThanOrEqual(
        part(tile, '.weekly-milestone-heading').getBoundingClientRect().bottom - SLACK,
      );
      expect(art.bottom).toBeLessThanOrEqual(
        part(tile, '.weekly-milestone-footer').getBoundingClientRect().top + SLACK,
      );
    }
    // The extra height scrolls inside the panel; the window itself stays put.
    expect(win.getBoundingClientRect().bottom).toBeLessThanOrEqual(768 + SLACK);
    const panel = part(win, '#weekly-rewards-panel');
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
  });

  it.each([
    [1920, 1080, 1],
    [1366, 768, 1.5],
  ])(
    'at %ix%i and UI scale %s the loot button rides the status line, scrolled or not',
    async (w, h, scale) => {
      const win = await mountVault(w, h, scale);
      const panel = part(win, '#weekly-rewards-panel');
      const header = part(win, '.weekly-rewards-header');
      const status = part(win, '.weekly-choice-status');
      const button = part(win, '#weekly-possible-loot-button');
      const check = () => {
        const s = status.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        // Inside the status row, right of its text, below the header (never on
        // the intro copy a taller, wrapped header pushes down).
        expect(b.top).toBeGreaterThanOrEqual(s.top - SLACK);
        expect(b.bottom).toBeLessThanOrEqual(s.bottom + SLACK);
        expect(b.top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom - SLACK);
        expect(b.right).toBeLessThanOrEqual(s.right + SLACK);
        // Clickable: the status box laid over the same row must not swallow it.
        const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
        expect(hit === button || button.contains(hit)).toBe(true);
      };
      check();
      panel.scrollTop = 40;
      check();
    },
  );

  it('the Dungeon Finder vault stays on screen at a high UI scale', async () => {
    const win = await mountVault(1920, 1080, 1.5, 'dungeon-finder');
    const box = win.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(-SLACK);
    expect(box.bottom).toBeLessThanOrEqual(1080 + SLACK);
    expect(box.right).toBeLessThanOrEqual(1920 + SLACK);
    // Its own sizing, untouched by the bank sheet's track floor.
    expect(box.height).toBeCloseTo(1080 * 0.88, 0);
  });
});
