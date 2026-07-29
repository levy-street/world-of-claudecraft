// Layout regression coverage for the resized-window fill contract, driven through
// the REAL painter, the REAL resize controller, and the REAL stylesheet in a real
// browser. A CSS text pin cannot catch this class of bug: every rule involved was
// individually valid before the fix, and the defect only appeared in the computed
// box geometry.
//
// The bug: dragging the leaderboard window taller grew the window but not the
// board. .lb-body kept its authored 56vh cap, so the extra height became a dead
// band under the list while the list itself stayed truncated behind its own
// scrollbar. The fix marks .lb-body as the .window-fill child of a flex-column
// window and drops that cap once window_resize.ts stamps .window-sized.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import { LeaderboardWindow } from '../../src/ui/leaderboard_window';
import { installWindowResize } from '../../src/ui/window_resize';
import { RESIZE_ENGAGE_SLOP } from '../../src/ui/window_resize_core';
import type { LeaderboardEntry, LeaderboardPage } from '../../src/world_api';
import { cleanup, host, stubDeps } from './_harness';

// Tall enough that the board overflows its 56vh cap (so the cap is actually
// binding, which is the precondition for the bug) and the shell's 85vh clamp
// still leaves real room to grow into.
const VIEWPORT = { width: 1200, height: 1000 };
// The window's own frame under the body: --window-pad plus the 1px border. The
// dead band the bug produced was an order of magnitude larger than this.
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

function entry(rank: number): LeaderboardEntry {
  return {
    rank,
    name: `Chronicler${rank}`,
    cls: 'warrior',
    level: 60,
    virtualLevel: 12,
    lifetimeXp: 5_000_000 - rank,
    prestigeRank: 0,
    title: null,
  };
}

// A full 50-row page: more rows than the 56vh cap can show, so the board is
// scrolling inside its own cap before the drag.
function fullPage(): LeaderboardPage {
  const leaders = Array.from({ length: 50 }, (_, i) => entry(i + 1));
  return {
    leaders,
    page: 0,
    pageCount: 2,
    total: 100,
    pageSize: 50,
  } as unknown as LeaderboardPage;
}

async function openLeaderboard(): Promise<HTMLElement> {
  const root = host('leaderboard-window');
  root.style.display = 'none'; // toggle() opens it
  const win = new LeaderboardWindow(
    stubDeps({
      root: () => root,
      world: () =>
        ({
          realm: 'Claudemoon',
          player: { name: 'Chronicler1', level: 60 },
          lifetimeXp: 5_000_000,
          leaderboard: () => Promise.resolve(fullPage()),
        }) as never,
      captureFocus: () => null,
      showDevBadges: () => true,
    }),
  );
  win.toggle();
  await win.render();
  return root;
}

// Installs the real controller and drags the SE grip by (dx, dy) author px, the
// same pointerdown / past-the-slop / move / up sequence a mouse produces.
function dragCorner(el: HTMLElement, dx: number, dy: number): void {
  teardownResize = installWindowResize({
    getScale: () => 1,
    // What Hud.setWindowPixelPosition does: convert the centering transform into
    // pixel left/top before the first size write.
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

function boxes(root: HTMLElement): {
  win: DOMRect;
  body: DOMRect;
  bodyEl: HTMLElement;
} {
  const bodyEl = root.querySelector<HTMLElement>('.lb-body');
  if (!bodyEl) throw new Error('the leaderboard body never rendered');
  return { win: root.getBoundingClientRect(), body: bodyEl.getBoundingClientRect(), bodyEl };
}

describe('leaderboard window resize', () => {
  it('grows the board with the window instead of leaving a dead band under it', async () => {
    const root = await openLeaderboard();
    const before = boxes(root);
    // Precondition: the authored 56vh cap is binding, so the board is already
    // scrolling. Without this the test could pass on a board that simply fits.
    expect(before.body.height).toBeCloseTo(VIEWPORT.height * 0.56, 0);
    expect(before.bodyEl.scrollHeight).toBeGreaterThan(before.bodyEl.clientHeight);

    dragCorner(root, 0, 400);

    const after = boxes(root);
    expect(root.classList.contains('window-sized')).toBe(true);
    const grewBy = after.win.height - before.win.height;
    // The drag has room to grow into (the shell's 85vh clamp is well above the
    // 56vh-capped starting height), or the assertions below prove nothing.
    expect(grewBy).toBeGreaterThan(50);
    // THE BUG: the board used to keep its 56vh height, so every pixel the window
    // gained became empty space under the list.
    expect(after.body.height - before.body.height).toBeCloseTo(grewBy, 0);
    expect(after.win.bottom - after.body.bottom).toBeLessThanOrEqual(WINDOW_FRAME_BELOW_BODY);
    // And the board scrolls INSIDE the window, rather than pushing the window
    // into its own scroll.
    expect(after.bodyEl.scrollHeight).toBeGreaterThan(after.bodyEl.clientHeight);
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight);
  });

  it('shows more rows after the drag, not just a taller box', async () => {
    const root = await openLeaderboard();
    const rowHeight =
      root.querySelector<HTMLElement>('.lb-row')?.getBoundingClientRect().height ?? 0;
    expect(rowHeight).toBeGreaterThan(0);
    const visibleBefore = Math.floor(boxes(root).bodyEl.clientHeight / rowHeight);

    dragCorner(root, 0, 400);

    const visibleAfter = Math.floor(boxes(root).bodyEl.clientHeight / rowHeight);
    expect(visibleAfter).toBeGreaterThan(visibleBefore);
  });

  it('shrinks the board back down with the window', async () => {
    const root = await openLeaderboard();
    const before = boxes(root);

    dragCorner(root, 0, -300);

    const after = boxes(root);
    expect(after.win.height).toBeLessThan(before.win.height);
    expect(after.body.height).toBeLessThan(before.body.height);
    expect(after.win.bottom - after.body.bottom).toBeLessThanOrEqual(WINDOW_FRAME_BELOW_BODY);
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight);
  });

  it('keeps the fill through a tab switch, which rebuilds the whole window', async () => {
    const root = await openLeaderboard();
    dragCorner(root, 0, 400);
    const sized = boxes(root);

    root.querySelector<HTMLButtonElement>('[data-leaderboard-tab="guilds"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    const rebuilt = boxes(root);
    // render() replaces the window's innerHTML, so the marker has to be re-emitted
    // by the painter rather than stamped once at open.
    expect(rebuilt.bodyEl.classList.contains('window-fill')).toBe(true);
    expect(rebuilt.win.height).toBeCloseTo(sized.win.height, 0);
    expect(rebuilt.win.bottom - rebuilt.body.bottom).toBeLessThanOrEqual(WINDOW_FRAME_BELOW_BODY);
  });

  it('leaves an untouched window on its authored layout', async () => {
    const root = await openLeaderboard();
    const title = root.querySelector<HTMLElement>('.panel-title')?.getBoundingClientRect();
    const tabs = root.querySelector<HTMLElement>('.lb-tabs')?.getBoundingClientRect();
    const { body, bodyEl } = boxes(root);
    if (!title || !tabs) throw new Error('the window chrome never rendered');
    expect(root.classList.contains('window-sized')).toBe(false);
    // The flex column must not re-open the gaps that block flow collapsed: 8px
    // under the header (.panel-title's margin-bottom, NOT it plus .lb-tabs' old
    // margin-top) and 8px under the tab strip (.lb-body's margin-top).
    expect(tabs.top - title.bottom).toBeCloseTo(8, 0);
    expect(body.top - tabs.bottom).toBeCloseTo(8, 0);
    // And the authored cap still governs an unsized window.
    expect(bodyEl.clientHeight).toBeLessThanOrEqual(Math.round(VIEWPORT.height * 0.56));
  });
});
