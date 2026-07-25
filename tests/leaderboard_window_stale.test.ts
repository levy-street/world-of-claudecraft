// @vitest-environment jsdom
//
// DOM behavioral guard: stale async board responses. The five boards share one
// .lb-body, so a slow response for an older tab (or page) must be dropped when
// it finally resolves; otherwise it overwrites the newer board's rows and
// mirrors its server-clamped page into the wrong tab's pager state through the
// board-dispatched page setter. Drives the real painter over jsdom (the source
// pins live in leaderboard_window.test.ts).

import { describe, expect, it, vi } from 'vitest';
import { LeaderboardWindow, type LeaderboardWindowDeps } from '../src/ui/leaderboard_window';
import type { DeedsLeaderboardPage, LeaderboardPage } from '../src/world_api';

function lbEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'leaderboard-window';
  el.className = 'window panel';
  // The async board render bails unless the window reads as open (display:block);
  // set it so render() completes its error-state paint deterministically.
  el.style.display = 'block';
  return el;
}

function fakeDeps(
  el: HTMLElement,
  overrides: Partial<LeaderboardWindowDeps> = {},
): LeaderboardWindowDeps {
  const reject = async () => {
    throw new Error('offline');
  };
  return {
    root: () => el,
    world: () =>
      ({
        realm: 'Testrealm',
        player: { name: 'Hero', level: 10, githubLogin: null },
        lifetimeXp: 500,
        leaderboard: reject,
        guildLeaderboard: reject,
        deedsLeaderboard: reject,
        devLeaderboard: reject,
        dailyRewardLeaderboard: reject,
      }) as never,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    showDevBadges: () => true,
    ...overrides,
  };
}

async function renderLb(
  el: HTMLElement,
  overrides: Partial<LeaderboardWindowDeps> = {},
): Promise<LeaderboardWindow> {
  const w = new LeaderboardWindow(fakeDeps(el, overrides));
  await w.render();
  return w;
}

describe('LeaderboardWindow: stale async board responses', () => {
  function rankedPlayersPage(): LeaderboardPage {
    return {
      leaders: [
        {
          rank: 1,
          name: 'Toprank',
          cls: 'warrior',
          level: 20,
          virtualLevel: 22,
          lifetimeXp: 1_000_000,
          prestigeRank: 0,
          title: null,
        },
      ],
      page: 0,
      pageCount: 1,
      total: 1,
      pageSize: 50,
    };
  }

  function rankedDeedsPage(page: number): DeedsLeaderboardPage {
    return {
      leaders: [
        {
          rank: 151,
          name: 'Chronicler',
          realm: 'Otherrealm',
          cls: 'mage',
          level: 20,
          renown: 4200,
          title: null,
        },
      ],
      page,
      pageCount: 5,
      total: 250,
      pageSize: 50,
    };
  }

  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('drops a slow deeds response that lands after switching back to players', async () => {
    const el = lbEl();
    let resolveDeeds: (page: DeedsLeaderboardPage) => void = () => {};
    const deedsPromise = new Promise<DeedsLeaderboardPage>((resolve) => {
      resolveDeeds = resolve;
    });
    const playerPagesRequested: number[] = [];
    const reject = async () => {
      throw new Error('offline');
    };
    const w = new LeaderboardWindow(
      fakeDeps(el, {
        world: () =>
          ({
            realm: 'Testrealm',
            player: { name: 'Hero', level: 10, githubLogin: null },
            lifetimeXp: 500,
            leaderboard: async (page: number) => {
              playerPagesRequested.push(page);
              return rankedPlayersPage();
            },
            deedsLeaderboard: () => deedsPromise,
            guildLeaderboard: reject,
            devLeaderboard: reject,
            dailyRewardLeaderboard: reject,
          }) as never,
      }),
    );
    await w.render();
    expect(el.querySelector('.lb-body .lb-row-players')).not.toBeNull();

    // Start the deeds fetch (held pending), then switch back before it lands.
    el.querySelector<HTMLElement>('[data-leaderboard-tab="deeds"]')?.click();
    el.querySelector<HTMLElement>('[data-leaderboard-tab="players"]')?.click();
    await flushAsync();
    expect(el.querySelector('.lb-body .lb-row-players')).not.toBeNull();

    // The held deeds response resolves last, carrying a server-clamped page 3.
    resolveDeeds(rankedDeedsPage(3));
    await flushAsync();

    // The stale response must not repaint the shared body over the players rows.
    expect(el.querySelector('.lb-body .lb-row-deeds')).toBeNull();
    expect(el.querySelector('.lb-body .lb-row-players')).not.toBeNull();

    // Nor may its page mirror leak into the players pager: the next players
    // render still requests page 0.
    await w.render();
    expect(playerPagesRequested[playerPagesRequested.length - 1]).toBe(0);
  });
});
