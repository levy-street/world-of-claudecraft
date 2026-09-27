// @vitest-environment happy-dom
//
// The World Quest rankings painter (src/ui/world_quest_leaderboard_window.ts)
// over happy-dom: open / close with focus return, the viewer passed to the
// read, the podium and list painted from a page, a card switch that refetches
// from page 0, the stale-answer guard, and the leaderboard tab launcher.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardWindow } from '../src/ui/leaderboard_window';
import { WorldQuestLeaderboardWindow } from '../src/ui/world_quest_leaderboard_window';
import type { WorldQuestLeaderboardPage } from '../src/world_api';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function ladderPage(board: string, over: Partial<WorldQuestLeaderboardPage> = {}) {
  return {
    board,
    leaders: Array.from({ length: 6 }, (_, i) => ({
      rank: i + 1,
      name: `Hero${i + 1}`,
      medal: i < 2 ? ('gold' as const) : null,
      metric: 50 - i,
    })),
    page: 0,
    pageSize: 50,
    pageCount: 1,
    total: 6,
    self: { rank: 40, name: 'Ari', medal: 'silver' as const, metric: 12 },
    ...over,
  } as WorldQuestLeaderboardPage;
}

function rig(read?: (board: string, page: number) => Promise<WorldQuestLeaderboardPage>) {
  const el = document.createElement('div');
  el.id = 'world-quest-leaderboard-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  const worldQuestLeaderboard = vi.fn(
    read ?? ((board: string) => Promise.resolve(ladderPage(board))),
  );
  const startWorldQuestActivity = vi.fn();
  const world = { player: { name: 'Ari' }, worldQuestLeaderboard, startWorldQuestActivity };
  const closeOthers = vi.fn();
  const restoreFocus = vi.fn();
  const opener = document.createElement('button');
  const window = new WorldQuestLeaderboardWindow({
    root: () => el,
    world: () => world as never,
    closeOthers,
    captureFocus: () => opener,
    restoreFocus,
  });
  return {
    el,
    window,
    worldQuestLeaderboard,
    closeOthers,
    restoreFocus,
    opener,
    startWorldQuestActivity,
  };
}

describe('world quest rankings window', () => {
  it('opens the six timed course boards and launches the selected route', async () => {
    const r = rig();
    r.window.open('glider_valleys_v2_lifetime');
    await flush();
    expect(r.el.querySelectorAll('.wql-card')).toHaveLength(6);
    expect(r.el.querySelector('#wql-title')?.textContent).toBe('Glider course records');
    expect(r.el.querySelector('.wql-board-title')?.textContent).toBe('Valley Circuit: All time');
    (r.el.querySelector('[data-glider-start]') as HTMLButtonElement).click();
    expect(r.startWorldQuestActivity).toHaveBeenCalledWith('wq_galecrest_slalom', {
      courseId: 'galecrest_practice_valleys',
    });
    expect(r.window.isOpen).toBe(false);
  });
  it('opens on the default board, asks for the viewer, and paints podium, list, and self', async () => {
    const r = rig();
    r.window.open();
    expect(r.window.isOpen).toBe(true);
    expect(r.el.style.display).toBe('flex');
    expect(r.closeOthers).toHaveBeenCalledTimes(1);
    expect(r.el.querySelector('.wql-state')?.getAttribute('role')).toBe('status');
    await flush();
    expect(r.worldQuestLeaderboard).toHaveBeenCalledWith('north_watch_cannon', 0, 50, 'Ari');
    expect(r.el.querySelector('#wql-title')?.textContent).toBe('World Quest Rankings');
    // Five medal world quests since the barricade horde was removed.
    expect(r.el.querySelectorAll('.wql-card')).toHaveLength(5);
    const active = r.el.querySelector('.wql-card-active');
    expect(active?.getAttribute('data-wql-board')).toBe('north_watch_cannon');
    expect(active?.getAttribute('aria-pressed')).toBe('true');
    expect(
      Array.from(r.el.querySelectorAll('.lbp-slot')).map((s) =>
        s.getAttribute('data-podium-place'),
      ),
    ).toEqual(['1', '2', '3']);
    expect(r.el.querySelectorAll('.wql-row:not(.wql-head)')).toHaveLength(3);
    expect(r.el.querySelector('.wql-self-rank')?.textContent).toBe('Rank 40');
    // Art rides a custom property so the stylesheet gradient stays underneath.
    expect(r.el.querySelector('.wql-card-active .wql-card-art')?.getAttribute('style')).toContain(
      "--wql-art:url('ui/world-quests/leaderboard/north_watch_cannon.webp')",
    );
    (r.el.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(r.window.isOpen).toBe(false);
    expect(r.restoreFocus).toHaveBeenCalledExactlyOnceWith(r.opener);
  });

  it('switches boards from a card and refetches from the first page', async () => {
    const r = rig();
    r.window.open();
    await flush();
    (r.el.querySelector('[data-wql-board="forge"]') as HTMLButtonElement).click();
    await flush();
    expect(r.worldQuestLeaderboard).toHaveBeenLastCalledWith('forge', 0, 50, 'Ari');
    expect(r.el.querySelector('.wql-card-active')?.getAttribute('data-wql-board')).toBe('forge');
    expect(document.activeElement?.getAttribute('data-wql-board')).toBe('forge');
  });

  it('drops a slow answer for a board the player already left', async () => {
    let releaseSlow: ((page: WorldQuestLeaderboardPage) => void) | null = null;
    const r = rig((board) =>
      board === 'north_watch_cannon'
        ? new Promise((resolve) => {
            releaseSlow = resolve;
          })
        : Promise.resolve(ladderPage(board, { leaders: [], total: 0, self: null })),
    );
    r.window.open();
    (r.el.querySelector('[data-wql-board="slalom"]') as HTMLButtonElement).click();
    await flush();
    expect(r.el.querySelector('.wql-card-active')?.getAttribute('data-wql-board')).toBe('slalom');
    releaseSlow!(ladderPage('north_watch_cannon'));
    await flush();
    expect(r.el.querySelector('.wql-card-active')?.getAttribute('data-wql-board')).toBe('slalom');
    expect(r.el.querySelector('.lbp-slot')).toBeNull();
    expect(r.el.querySelector('.wql-state')?.textContent).toMatch(/No scores on this board yet/);
  });

  it('paints the retry line when the read rejects', async () => {
    const r = rig(() => Promise.reject(new Error('down')));
    r.window.open();
    await flush();
    expect(r.el.querySelector('.wql-error')?.getAttribute('role')).toBe('alert');
    expect(r.el.querySelector('.wql-self')).toBeNull();
  });

  it('pages forward and keeps focus on the pager button', async () => {
    const r = rig((board, page) =>
      Promise.resolve(ladderPage(board, { page, pageCount: 3, total: 120 })),
    );
    r.window.open();
    await flush();
    (r.el.querySelector('[data-wql-page="next"]') as HTMLButtonElement).click();
    await flush();
    expect(r.worldQuestLeaderboard).toHaveBeenLastCalledWith('north_watch_cannon', 1, 50, 'Ari');
    expect(r.el.querySelector('.wql-page-status')?.textContent).toBe('Page 2 of 3');
    expect(r.el.querySelector('.lbp-slot')).toBeNull();
    expect(document.activeElement?.getAttribute('data-wql-page')).toBe('next');
  });
});

describe('leaderboard World Quests tab', () => {
  // The painter tests above leave their own rankings roots in the document;
  // clear them so getElementById finds only this rig's root.
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function leaderboardRig(opts: { launcher: boolean; rankingsRoot: boolean }) {
    const el = document.createElement('div');
    el.id = 'leaderboard-window';
    document.body.appendChild(el);
    const rankings = document.createElement('div');
    rankings.id = 'world-quest-leaderboard-window';
    if (opts.rankingsRoot) document.body.appendChild(rankings);
    const world = {
      realm: '',
      player: { name: 'Ari', level: 1, guild: null },
      lifetimeXp: 0,
      activeTitle: null,
      leaderboard: vi.fn(() => new Promise(() => {})),
      worldQuestLeaderboard: vi.fn((board: string) =>
        Promise.resolve(ladderPage(board, { leaders: [], total: 0, self: null })),
      ),
    };
    const windowFocusFor = vi.fn(() => ({ captureFocus: () => null, restoreFocus: vi.fn() }));
    const lb = new LeaderboardWindow({
      root: () => el,
      world: () => world as never,
      closeOthers: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      showDevBadges: () => false,
      ...(opts.launcher ? { windowFocusFor } : {}),
    });
    lb.toggle();
    return { el, rankings, world, lb, windowFocusFor };
  }

  it('launches the rankings window in place of the leaderboard, with its own focus bridge', () => {
    const r = leaderboardRig({ launcher: true, rankingsRoot: true });
    (r.el.querySelector('[data-leaderboard-tab="worldQuests"]') as HTMLButtonElement).click();
    expect(r.el.style.display).toBe('none');
    expect(r.rankings.style.display).toBe('flex');
    expect(r.rankings.querySelectorAll('.wql-card')).toHaveLength(5);
    expect(r.windowFocusFor).toHaveBeenCalledExactlyOnceWith('#world-quest-leaderboard-window');
    expect(r.el.querySelector('.lb-wq-chips')).toBeNull();
    expect(r.world.worldQuestLeaderboard).toHaveBeenCalledWith('north_watch_cannon', 0, 50, 'Ari');
    // The leaderboard close path (Escape, the toggle) also closes the rankings.
    r.lb.toggle();
    expect(r.rankings.style.display).toBe('none');
    expect(r.el.style.display).toBe('none');
  });

  it('arrowing onto the tab only moves focus, it never opens the window', () => {
    const r = leaderboardRig({ launcher: true, rankingsRoot: true });
    const daily = r.el.querySelector('[data-leaderboard-tab="daily"]') as HTMLButtonElement;
    daily.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(r.rankings.style.display).not.toBe('flex');
    expect(r.el.style.display).toBe('flex');
    expect(document.activeElement?.getAttribute('data-leaderboard-tab')).toBe('worldQuests');
  });

  it('keeps the in-window chip board without a focus bridge or a rankings root', async () => {
    for (const opts of [
      { launcher: false, rankingsRoot: true },
      { launcher: true, rankingsRoot: false },
    ]) {
      const r = leaderboardRig(opts);
      (r.el.querySelector('[data-leaderboard-tab="worldQuests"]') as HTMLButtonElement).click();
      await flush();
      expect(r.el.style.display).toBe('flex');
      expect(r.el.querySelector('.lb-wq-chips')).not.toBeNull();
      document.body.innerHTML = '';
    }
  });
});
