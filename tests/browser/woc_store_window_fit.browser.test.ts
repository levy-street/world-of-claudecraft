// The WOC Store window's fit to the screen, measured in a REAL browser.
//
// The bug (Discord bug report, desktop client): the store ran off the bottom of
// the screen, hiding its last rows and the resize grip. #daily-rewards-window
// lives inside #ui, which carries `zoom: var(--ui-scale)`, but its desktop rule
// capped the window and its body in raw vh, so at any UI scale above 1 the zoom
// re-multiplied the cap and the window overshot the screen. The fix divides by
// --window-scale like the shared .window clamp does.
//
// The reporter's workaround (drag the window shorter) failed for a second
// reason pinned here too: .ui-window clips its overflow and the body kept its
// own vh cap, so a shortened window cut the store off with no way to scroll to
// it. The window is now a flex column whose body is the .window-fill child, so
// a drag hands the body exactly the height that is left.
//
// jsdom and happy-dom implement no layout and no zoom, so only a real browser
// can see any of this. Mount recipe: tests/browser/store_purchase_prompt_stacking.

import '../../src/styles/index.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

vi.mock('../../src/render/armory_preview', () => ({
  armoryPreviewReady: () => true,
  createArmoryPreview: () => ({
    setActive() {},
    setAppearance() {},
    setScene() {},
    setMode() {},
    setSkin() {},
    prewarm: async () => undefined,
    finishPrewarm() {},
    dispose() {},
  }),
}));

import { DailyRewardsWindow, type DailyRewardsWindowDeps } from '../../src/ui/daily_rewards_window';
import { installWindowResize } from '../../src/ui/window_resize';
import { RESIZE_ENGAGE_SLOP } from '../../src/ui/window_resize_core';
import type { IWorld } from '../../src/world_api';
import { cleanup } from './_harness';

// Sub-pixel slack for the zoom's rounding; the regression overshot by far more.
const SLACK = 1;

const mounted: DailyRewardsWindow[] = [];
let teardownResize: (() => void) | null = null;

async function mountStore(
  width: number,
  height: number,
  uiScale: number,
  storeEnabled = true,
): Promise<HTMLElement> {
  await page.viewport(width, height);
  const style = document.documentElement.style;
  style.setProperty('--app-vw', `${width}px`);
  style.setProperty('--app-vh', `${height}px`);
  style.setProperty('--ui-scale', String(uiScale));
  // The real page shape: the store window inside the zoomed #ui (index.html).
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  const root = document.createElement('div');
  root.id = 'daily-rewards-window';
  root.className = 'window panel ui-window';
  root.style.display = 'none';
  ui.appendChild(root);
  const world = {
    player: {
      templateId: 'warrior',
      mainhandItemId: null,
      offhandItemId: null,
      skin: 'warrior_a',
      skinCatalog: 'class',
      mountSkinId: null,
    },
    accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {}, mountSkinIds: [] },
    ownedMounts: () => [],
    bankPurchasedSlots: 0,
    changeWeaponSkin: () => undefined,
    changeMountSkin: () => undefined,
  };
  const deps: DailyRewardsWindowDeps = {
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: () => undefined,
    captureFocus: () => null,
    restoreFocus: () => undefined,
    storeEnabled: () => storeEnabled,
    storeSnapshot: async () => ({ available: true, balance: 5_000, items: [] }),
    spendStoreItem: async () => ({ granted: false, balance: 5_000, costClaudium: 0, reason: null }),
  };
  const win = new DailyRewardsWindow(deps);
  mounted.push(win);
  if (!storeEnabled) {
    // Rewards-only mode: the shell (title + body) paints synchronously on open.
    win.toggle();
    return root;
  }
  win.openStore();
  await vi.waitFor(() => {
    expect(root.querySelector('[data-armory-skin]')).not.toBeNull();
  });
  return root;
}

function body(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>('.woc-store-body');
  expect(el, 'the store body never rendered').not.toBeNull();
  return el as HTMLElement;
}

// Installs the real controller and drags the SE grip by (dx, dy) screen px, the
// same pointerdown / past-the-slop / move / up sequence a mouse produces.
function dragCorner(el: HTMLElement, scale: number, dx: number, dy: number): void {
  teardownResize = installWindowResize({
    getScale: () => scale,
    pinWindow: (target, rect) => {
      target.style.left = `${rect.left / scale}px`;
      target.style.top = `${rect.top / scale}px`;
      target.style.transform = 'none';
    },
    isCoarsePointer: () => false,
  });
  const rect = el.getBoundingClientRect();
  const x = rect.right - 4;
  const y = rect.bottom - 4;
  const fire = (type: string, cx: number, cy: number, buttons: number): void => {
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons,
    });
    (type === 'pointerdown' ? el : document).dispatchEvent(ev);
  };
  fire('pointerdown', x, y, 1);
  fire('pointermove', x + RESIZE_ENGAGE_SLOP, y + RESIZE_ENGAGE_SLOP, 1);
  fire('pointermove', x + dx, y + dy, 1);
  fire('pointerup', x + dx, y + dy, 0);
}

afterEach(() => {
  teardownResize?.();
  teardownResize = null;
  for (const win of mounted.splice(0)) win.close();
  cleanup();
  for (const prop of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(prop);
});

describe('WOC Store window fits the screen', () => {
  it.each([
    [1920, 1080, 1],
    [1920, 1080, 1.25],
    [1920, 1080, 1.5],
    [1366, 768, 1.25],
    [2560, 1440, 2],
  ])('at %ix%i and UI scale %s the whole window stays on screen', async (w, h, scale) => {
    const root = await mountStore(w, h, scale);
    const box = root.getBoundingClientRect();
    const bodyEl = body(root);
    // Precondition: the catalogue is taller than the screen, so the height cap
    // is what binds. Without this a short store would pass on any build.
    expect(bodyEl.scrollHeight).toBeGreaterThan(bodyEl.clientHeight);
    expect(box.top).toBeGreaterThanOrEqual(-SLACK);
    expect(box.bottom).toBeLessThanOrEqual(h + SLACK);
    expect(box.left).toBeGreaterThanOrEqual(-SLACK);
    expect(box.right).toBeLessThanOrEqual(w + SLACK);
    // The body (and so the last row once scrolled) ends inside the window.
    expect(bodyEl.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom + SLACK);
  });

  it.each([1, 1.25])(
    'at UI scale %s a shortened window still scrolls to its last row',
    async (scale) => {
      const root = await mountStore(1920, 1080, scale);
      const before = root.getBoundingClientRect();

      dragCorner(root, scale, 0, -400);

      const after = root.getBoundingClientRect();
      expect(root.classList.contains('window-sized')).toBe(true);
      expect(after.height).toBeLessThan(before.height - 300);
      const bodyEl = body(root);
      // THE workaround bug: the body kept its viewport cap and ran under the
      // clipped window bottom, so its last rows could never scroll into view.
      expect(bodyEl.getBoundingClientRect().bottom).toBeLessThanOrEqual(after.bottom + SLACK);
      expect(bodyEl.scrollHeight).toBeGreaterThan(bodyEl.clientHeight);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      const rows = bodyEl.querySelectorAll<HTMLElement>('[data-armory-skin]');
      const last = rows[rows.length - 1];
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(after.bottom + SLACK);
    },
  );

  it('rewards-only mode keeps one 8px gap under the title', async () => {
    // With no tab strip the title and body are adjacent. Block flow collapsed
    // their two 8px margins into one; the flex column does not collapse, so one
    // margin is dropped to keep the gap the window always had.
    const root = await mountStore(1920, 1080, 1, false);
    const title = root.querySelector<HTMLElement>('.panel-title');
    expect(title, 'the rewards title never rendered').not.toBeNull();
    expect(root.querySelector('.woc-store-tabs')).toBeNull();
    const gap =
      body(root).getBoundingClientRect().top -
      (title as HTMLElement).getBoundingClientRect().bottom;
    expect(gap).toBeCloseTo(8, 0);
  });
});
