// Real-browser regression for issue #3500. The fixture uses the real Dungeon
// Finder painter, resize controller, stylesheet, item icons, and accessible
// money markup because the absolutely positioned coin-unit labels are the
// descendant that exposes an uncontained catalogue detail pane.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import { DungeonFinderWindow } from '../../src/ui/dungeon_finder_window';
import { knownItemIconHtml } from '../../src/ui/unknown_item_icon';
import { installWindowResize } from '../../src/ui/window_resize';
import { RESIZE_ENGAGE_SLOP } from '../../src/ui/window_resize_core';
import type { DungeonFinderInfo } from '../../src/world_api';
import { cleanup, host, stubDeps } from './_harness';

const VIEWPORT = { width: 1200, height: 1000 };
const WINDOW_FRAME_BELOW_BODY = 16;

let teardownResize: (() => void) | null = null;

beforeEach(async () => {
  await browserPage.viewport(VIEWPORT.width, VIEWPORT.height);
  document.documentElement.style.setProperty('--app-vw', `${VIEWPORT.width}px`);
  document.documentElement.style.setProperty('--app-vh', `${VIEWPORT.height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
});

afterEach(() => {
  teardownResize?.();
  teardownResize = null;
  cleanup();
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  document.documentElement.style.removeProperty('--ui-scale');
});

function finderInfo(): DungeonFinderInfo {
  return {
    roles: ['tank'],
    eligibleRoles: ['tank', 'dps'],
    queue: null,
    cooldown: 0,
    proposal: null,
    myListing: null,
    myApplication: null,
  };
}

function moneyHtml(): string {
  return (
    '<span class="money-inline" aria-label="20 gold 0 silver 0 copper">' +
    '<span class="coin-part"><span class="coin-amount">20</span><span class="coin g" aria-hidden="true"></span><span class="visually-hidden">gold</span></span>' +
    '<span class="coin-part"><span class="coin-amount">0</span><span class="coin s" aria-hidden="true"></span><span class="visually-hidden">silver</span></span>' +
    '<span class="coin-part"><span class="coin-amount">0</span><span class="coin c" aria-hidden="true"></span><span class="visually-hidden">copper</span></span>' +
    '</span>'
  );
}

function openDungeonFinder(): HTMLElement {
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  const root = host('dungeon-finder-window');
  ui.appendChild(root);
  root.style.display = 'none';
  const win = new DungeonFinderWindow(
    stubDeps({
      root: () => root,
      world: () =>
        ({
          dungeonFinderInfo: finderInfo(),
          dungeonFinderBoard: [],
          player: { level: 1 },
          cfg: { playerClass: 'warrior' },
          playerId: 1,
          talentRole: null,
          partyInfo: null,
          raidLockouts: () => [],
        }) as never,
      captureFocus: () => null,
      itemIcon: knownItemIconHtml,
      moneyHtml,
    }),
  );
  win.open();
  return root;
}

function dragCorner(el: HTMLElement, dy: number): void {
  teardownResize?.();
  teardownResize = installWindowResize({
    getScale: () => 1,
    pinWindow: (target, rect) => {
      target.style.left = `${rect.left}px`;
      target.style.top = `${rect.top}px`;
      target.style.transform = 'none';
    },
    isCoarsePointer: () => false,
  });
  const rect = el.getBoundingClientRect();
  const x = rect.left + el.clientLeft + el.clientWidth - 4;
  const y = rect.top + el.clientTop + el.clientHeight - 4;
  const fire = (type: string, cx: number, cy: number, buttons: number): void => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons,
    });
    (type === 'pointerdown' ? el : document).dispatchEvent(event);
  };
  fire('pointerdown', x, y, 1);
  fire('pointermove', x + RESIZE_ENGAGE_SLOP, y + RESIZE_ENGAGE_SLOP, 1);
  fire('pointermove', x, y + dy, 1);
  fire('pointerup', x, y + dy, 0);
}

function boxes(root: HTMLElement): {
  win: DOMRect;
  body: DOMRect;
  detailEl: HTMLElement;
} {
  const bodyEl = root.querySelector<HTMLElement>('.df-body');
  const detailEl = root.querySelector<HTMLElement>('.df-detail');
  if (!bodyEl || !detailEl) throw new Error('the Dungeon Finder catalogue never rendered');
  return {
    win: root.getBoundingClientRect(),
    body: bodyEl.getBoundingClientRect(),
    detailEl,
  };
}

describe('Dungeon Finder window resize', () => {
  it('keeps a long catalogue detail inside its own scrollbar', () => {
    const root = openDungeonFinder();

    dragCorner(root, -300);
    const shrunken = boxes(root);
    expect(root.classList.contains('window-sized')).toBe(true);
    expect(shrunken.win.bottom - shrunken.body.bottom).toBeLessThanOrEqual(WINDOW_FRAME_BELOW_BODY);

    const longDetail = root.querySelector<HTMLButtonElement>(
      '[data-row="nythraxis_boss_arena_heroic"]',
    );
    if (!longDetail) throw new Error('the long Dungeon Finder detail row never rendered');
    longDetail.click();

    const selected = boxes(root);
    const hiddenMoneyUnit = selected.detailEl.querySelector<HTMLElement>(
      '.money-inline .visually-hidden',
    );
    if (!hiddenMoneyUnit) throw new Error('the accessible money label never rendered');
    expect(getComputedStyle(hiddenMoneyUnit).position).toBe('absolute');
    expect(selected.detailEl.scrollHeight).toBeGreaterThan(selected.detailEl.clientHeight);
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight);

    selected.detailEl.scrollTop = selected.detailEl.scrollHeight;
    expect(selected.detailEl.scrollTop).toBeGreaterThan(0);
    expect(root.scrollTop).toBe(0);

    dragCorner(root, 300);
    const regrown = boxes(root);
    const grewBy = regrown.win.height - selected.win.height;
    expect(grewBy).toBeGreaterThan(50);
    expect(regrown.body.height - selected.body.height).toBeCloseTo(grewBy, 0);
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight);
    expect(regrown.win.bottom - regrown.body.bottom).toBeLessThanOrEqual(WINDOW_FRAME_BELOW_BODY);
  });
});
