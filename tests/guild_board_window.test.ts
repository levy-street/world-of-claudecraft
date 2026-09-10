// @vitest-environment happy-dom
//
// The signpost guild board window: the ranked board with pledge affordances
// (the surface the leaderboard's guilds tab used to carry), the note's soft
// profanity mask, the per-guild roster drill-in (Guild Master, then
// officers, then members, each rank tier ranked by lifetime XP), and the
// guild board categories layer: the new-player-friendly chip and tick-box
// filter (ticked by default from the Proving Shore's board), the filtered
// empty state, and the live "officers online" dot with its tooltip.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVING_SHORE_NOTICEBOARD_ID } from '../src/sim/content/noticeboards';
import type { GuildBoardCategory } from '../src/sim/guild_board_category';
import { GuildBoardWindow, type GuildBoardWindowDeps } from '../src/ui/hud/guild_board';
import type {
  GuildLeaderboardEntry,
  GuildLeaderboardPage,
  GuildRosterInfo,
  IWorld,
} from '../src/world_api';

const STORMCALLERS: GuildLeaderboardEntry = {
  rank: 1,
  name: 'Stormcallers',
  memberCount: 12,
  totalLifetimeXp: 2_500_000,
  topLevel: 20,
  pledgesOpen: true,
  pledgeMinLevel: 10,
  pledgeNote: 'we love grog',
  newPlayerFriendly: true,
  onlineOfficers: [
    { name: 'Boss', rank: 'leader' },
    { name: 'Right Hand', rank: 'officer' },
  ],
};

const GATEKEPT: GuildLeaderboardEntry = {
  rank: 2,
  name: 'Gatekept',
  memberCount: 2,
  totalLifetimeXp: 50_000,
  topLevel: 12,
  pledgesOpen: false,
};

const PAGE: GuildLeaderboardPage = {
  leaders: [STORMCALLERS, GATEKEPT],
  page: 0,
  pageCount: 1,
  total: 2,
  pageSize: 20,
};

const ROSTER: GuildRosterInfo = {
  guild: 'Stormcallers',
  members: [
    { name: 'Boss', rank: 'leader', class: 'warrior', level: 20, lifetimeXp: 900_000 },
    { name: 'Right Hand', rank: 'officer', class: 'priest', level: 20, lifetimeXp: 800_000 },
    { name: 'Fresh Blood', rank: 'member', class: 'rogue', level: 5, lifetimeXp: 40_000 },
  ],
};

function pageOf(
  leaders: GuildLeaderboardEntry[],
  category: GuildBoardCategory | null = null,
): GuildLeaderboardPage {
  return {
    leaders,
    page: 0,
    pageCount: 1,
    total: leaders.length,
    pageSize: 20,
    ...(category === null ? {} : { category }),
  };
}

function fakeWorld(overrides: Partial<IWorld> = {}): IWorld {
  return {
    realm: 'Testrealm',
    player: { name: 'Newbie', level: 12 },
    socialInfo: { guild: null, myPledge: null },
    guildLeaderboard: async () => PAGE,
    guildRoster: async (name: string) => (name === 'Stormcallers' ? ROSTER : null),
    guildPledge: () => {},
    ...overrides,
  } as unknown as IWorld;
}

describe('GuildBoardWindow', () => {
  let root: HTMLElement;
  let win: GuildBoardWindow;
  let world: IWorld;
  let pledged: string[];
  let tooltips: { el: HTMLElement; html: () => string }[];

  function deps(overrides: Partial<GuildBoardWindowDeps> = {}): GuildBoardWindowDeps {
    return {
      root: () => root,
      world: () => world,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      maskPlayerText: (text) => text.replace(/grog/g, '****'),
      attachTooltip: (el, html) => void tooltips.push({ el, html }),
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="guild-board-window" class="window panel"></div>';
    root = document.getElementById('guild-board-window') as HTMLElement;
    pledged = [];
    tooltips = [];
    world = fakeWorld({ guildPledge: (name: string) => void pledged.push(name) } as never);
    win = new GuildBoardWindow(deps());
  });

  afterEach(() => {
    win.close();
    document.body.innerHTML = '';
  });

  async function settle(): Promise<void> {
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-row-guild, .lb-empty, .lb-error')) throw new Error('pending');
    });
  }

  async function openAndSettle(boardId?: string): Promise<void> {
    win.open(boardId);
    await settle();
  }

  it('opens on the ranked board with status, floor, masked note, and a Pledge button', async () => {
    // Act
    await openAndSettle();

    // Assert
    const rows = [...root.querySelectorAll('.lb-guild-entry')];
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(first.querySelector('.gb-roster-link')?.textContent).toBe('Stormcallers');
    expect(first.querySelector('.gb-roster-link')?.classList.contains('guild-tier-2')).toBe(true);
    expect(first.querySelector('.lb-pledge-status.open')?.textContent).toBe('Accepting pledges');
    expect(first.querySelector('.lb-pledge-floor')?.textContent).toBe('Level 10+');
    expect(first.querySelector('.lb-guild-note')?.textContent).toBe('we love ****');
    // The unguilded level-12 viewer clears the level-10 floor: the button shows.
    expect(first.querySelector('[data-guild-pledge]')).not.toBeNull();
    const second = rows[1] as HTMLElement;
    expect(second.querySelector('.lb-pledge-status.closed')?.textContent).toBe(
      'Not accepting pledges',
    );
    expect(second.querySelector('[data-guild-pledge]')).toBeNull();
  });

  it('sends the pledge command and flips the row to its Pledged chip', async () => {
    // Arrange
    await openAndSettle();
    const button = root.querySelector('[data-guild-pledge]') as HTMLButtonElement;
    expect(button?.dataset.guildPledge).toBe('Stormcallers');

    // Act
    button.click();
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-pledge-chip.on')) throw new Error('pending');
    });

    // Assert
    expect(pledged).toEqual(['Stormcallers']);
    expect(root.querySelector('.lb-pledge-chip.on')?.textContent).toBe('Pledged');
  });

  it('drills into a guild roster ordered Guild Master, officers, members', async () => {
    // Arrange
    await openAndSettle();

    // Act
    (root.querySelector('[data-guild-roster="Stormcallers"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!root.querySelector('.gb-row-roster')) throw new Error('pending');
    });

    // Assert
    const rows = [...root.querySelectorAll('.gb-row-roster')].slice(1); // drop the header row
    expect(rows.map((r) => r.querySelector('.lb-name')?.textContent)).toEqual([
      'Boss',
      'Right Hand',
      'Fresh Blood',
    ]);
    expect(rows[0].querySelector('.gb-rank-chip')?.textContent).toBe('Guild Master');
    expect(rows[0].querySelector('.gb-class')?.textContent).toBe('Warrior');
    expect((rows[0].querySelector('.gb-class') as HTMLElement).style.color).not.toBe('');
    expect(rows[1].querySelector('.gb-rank-chip')?.textContent).toBe('Officer');
    expect(rows[2].querySelector('.gb-rank-chip')?.textContent).toBe('Member');
    // The back control returns to the board.
    (root.querySelector('[data-board-back]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-guild-entry')) throw new Error('pending');
    });
  });

  it('keeps keyboard focus on the close button after a pledge click (WCAG 2.4.3)', async () => {
    // Arrange
    await openAndSettle();

    // Act: the clicked button re-renders as the Pledged chip.
    (root.querySelector('[data-guild-pledge]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-pledge-chip.on')) throw new Error('pending');
    });

    // Assert: focus landed on the close button, never <body>.
    expect(document.activeElement).toBe(root.querySelector('[data-close]'));
  });

  it('returns keyboard focus to the drilled-into guild on back-out', async () => {
    // Arrange
    await openAndSettle();
    (root.querySelector('[data-guild-roster="Stormcallers"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!root.querySelector('[data-board-back]')) throw new Error('pending');
    });

    // Act
    (root.querySelector('[data-board-back]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-guild-entry')) throw new Error('pending');
    });

    // Assert: the guild just left holds focus, not row one.
    expect(document.activeElement).toBe(root.querySelector('[data-guild-roster="Stormcallers"]'));
  });

  it('shows the retry error state when the roster read rejects (a dead server)', async () => {
    // Arrange
    world = fakeWorld({
      guildRoster: async () => {
        throw new Error('network down');
      },
    } as never);
    await openAndSettle();

    // Act
    (root.querySelector('[data-guild-roster="Stormcallers"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-error')) throw new Error('pending');
    });

    // Assert: the retry message, never the nothing-posted misread.
    expect(root.querySelector('.lb-error')?.textContent).not.toBe('');
    expect(root.querySelector('[data-board-back]')).not.toBeNull();
  });

  it('renders the localized nothing-posted state when the board is empty (offline)', async () => {
    // Arrange
    world = fakeWorld({
      guildLeaderboard: async () => pageOf([]),
      socialInfo: null,
    } as never);

    // Act
    await openAndSettle();

    // Assert: no filter strip either; there is nothing to filter.
    expect(root.querySelector('.lb-empty')?.textContent).toBe('Nothing seems posted.');
    expect(root.querySelector('[data-board-filter]')).toBeNull();
  });

  // ---- guild board categories: the chip, the tick box, the filtered empty state ----

  it('wears the new-player-friendly chip on an opted-in guild only', async () => {
    await openAndSettle();

    const rows = [...root.querySelectorAll('.lb-guild-entry')];
    expect(rows[0].querySelector('.gb-tag-new-players')?.textContent).toBe('New player friendly');
    expect(rows[0].querySelector('.gb-tag-new-players svg')).not.toBeNull();
    expect(rows[1].querySelector('.gb-tag-new-players')).toBeNull();
  });

  it('opens a town board on the whole ranking, with the filter tick box clear', async () => {
    const reads: (GuildBoardCategory | null | undefined)[] = [];
    world = fakeWorld({
      guildLeaderboard: async (_p: number, _s: number, category?: GuildBoardCategory | null) => {
        reads.push(category);
        return PAGE;
      },
    } as never);

    await openAndSettle('eastbrook_noticeboard');

    expect(reads).toEqual([null]);
    expect(win.activeCategory).toBeNull();
    const box = root.querySelector('[data-board-filter]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(root.querySelector('.gb-filter-chip')?.classList.contains('active')).toBe(false);
  });

  it('opens the Proving Shore board on the new-player-friendly guilds, tick box ticked', async () => {
    const reads: (GuildBoardCategory | null | undefined)[] = [];
    world = fakeWorld({
      guildLeaderboard: async (_p: number, _s: number, category?: GuildBoardCategory | null) => {
        reads.push(category);
        return pageOf([STORMCALLERS], category ?? null);
      },
    } as never);

    await openAndSettle(PROVING_SHORE_NOTICEBOARD_ID);

    expect(reads).toEqual(['newPlayerFriendly']);
    expect(win.activeCategory).toBe('newPlayerFriendly');
    const box = root.querySelector('[data-board-filter]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(root.querySelector('.gb-filter-chip')?.classList.contains('active')).toBe(true);
    expect(root.querySelectorAll('.lb-guild-entry')).toHaveLength(1);
  });

  it('re-reads the board from page one under the flipped filter and keeps focus on the box', async () => {
    const reads: { page: number; category: GuildBoardCategory | null | undefined }[] = [];
    world = fakeWorld({
      guildLeaderboard: async (page: number, _s: number, category?: GuildBoardCategory | null) => {
        reads.push({ page, category });
        return category ? pageOf([STORMCALLERS], category) : { ...PAGE, page, pageCount: 3 };
      },
    } as never);
    await openAndSettle();
    // Page forward first, so the filter flip provably resets to page one.
    (root.querySelector('[data-board-page="next"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (reads.length < 2) throw new Error('pending');
    });

    // Act
    const box = root.querySelector('[data-board-filter]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      if (root.querySelectorAll('.lb-guild-entry').length !== 1) throw new Error('pending');
    });

    // Assert
    expect(reads).toEqual([
      { page: 0, category: null },
      { page: 1, category: null },
      { page: 0, category: 'newPlayerFriendly' },
    ]);
    expect(win.activeCategory).toBe('newPlayerFriendly');
    expect(document.activeElement).toBe(root.querySelector('[data-board-filter]'));
  });

  it('falls back to the whole board when the Proving Shore default view is empty on open', async () => {
    // No guild has opted in yet: a brand-new player must not meet an empty
    // board as their first impression, so the default view falls back once.
    const reads: (GuildBoardCategory | null | undefined)[] = [];
    world = fakeWorld({
      guildLeaderboard: async (_p: number, _s: number, category?: GuildBoardCategory | null) => {
        reads.push(category);
        return category ? pageOf([], category) : PAGE;
      },
    } as never);
    await openAndSettle(PROVING_SHORE_NOTICEBOARD_ID);
    await vi.waitFor(() => {
      if (root.querySelectorAll('.lb-guild-entry').length !== 2) throw new Error('pending');
    });

    expect(reads).toEqual(['newPlayerFriendly', null]);
    expect(win.activeCategory).toBeNull();
    expect((root.querySelector('[data-board-filter]') as HTMLInputElement).checked).toBe(false);
  });

  it('renders the filtered empty state with the way back when the PLAYER flips the filter on', async () => {
    world = fakeWorld({
      guildLeaderboard: async (_p: number, _s: number, category?: GuildBoardCategory | null) =>
        category ? pageOf([], category) : PAGE,
    } as never);
    await openAndSettle('eastbrook_noticeboard');
    const box = root.querySelector('[data-board-filter]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      if (!root.querySelector('.gb-filter-empty')) throw new Error('pending');
    });

    // The strip stays (the tick box is the way back), and so does the button;
    // the player's own flip never falls back behind their back.
    expect(root.querySelector('.gb-filter-empty-text')?.textContent).toBe(
      'No guild has opened its doors to new players yet.',
    );
    expect((root.querySelector('[data-board-filter]') as HTMLInputElement).checked).toBe(true);
    expect(win.activeCategory).toBe('newPlayerFriendly');

    // Act
    (root.querySelector('[data-board-show-all]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      if (root.querySelectorAll('.lb-guild-entry').length !== 2) throw new Error('pending');
    });

    // Assert
    expect(win.activeCategory).toBeNull();
    expect((root.querySelector('[data-board-filter]') as HTMLInputElement).checked).toBe(false);
  });

  it('keeps the filter strip on a failed filtered read, so the way back survives the error', async () => {
    world = fakeWorld({
      guildLeaderboard: async (_p: number, _s: number, category?: GuildBoardCategory | null) => {
        if (category) throw new Error('network down');
        return PAGE;
      },
    } as never);
    await openAndSettle('eastbrook_noticeboard');
    const box = root.querySelector('[data-board-filter]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-error')) throw new Error('pending');
    });

    expect(root.querySelector('[data-board-filter]')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-board-filter]'));
  });

  it('clears the tick box when the server did not honour the category (an older server)', async () => {
    // A pre-category server ignores ?category and answers the whole board
    // with no echo: the window must render the filter it GOT, never label
    // every guild "New player friendly".
    world = fakeWorld({ guildLeaderboard: async () => PAGE } as never);
    await openAndSettle(PROVING_SHORE_NOTICEBOARD_ID);

    expect(root.querySelectorAll('.lb-guild-entry')).toHaveLength(2);
    expect((root.querySelector('[data-board-filter]') as HTMLInputElement).checked).toBe(false);
    expect(win.activeCategory).toBeNull();
  });

  it('re-reading a signpost mid-open resets the view to that board default', async () => {
    world = fakeWorld({
      guildLeaderboard: async (_p: number, _s: number, category?: GuildBoardCategory | null) =>
        category ? pageOf([STORMCALLERS], category) : PAGE,
    } as never);
    await openAndSettle(PROVING_SHORE_NOTICEBOARD_ID);
    expect(win.activeCategory).toBe('newPlayerFriendly');

    win.open('eastbrook_noticeboard');
    await vi.waitFor(() => {
      if (root.querySelectorAll('.lb-guild-entry').length !== 2) throw new Error('pending');
    });

    expect(win.activeCategory).toBeNull();
    expect(win.isOpen).toBe(true);
  });

  // ---- officer presence: the dot and its tooltip ----

  it('shows the presence dot only where an officer is online, naming them for a reader', async () => {
    await openAndSettle();

    const rows = [...root.querySelectorAll('.lb-guild-entry')];
    const dot = rows[0].querySelector('[data-guild-presence]') as HTMLButtonElement;
    expect(dot).not.toBeNull();
    expect(dot.tagName).toBe('BUTTON');
    expect(dot.querySelector('.gb-presence-dot')).not.toBeNull();
    expect(dot.getAttribute('aria-label')).toBe(
      'Officers online: Boss (Guild Master) and Right Hand (Officer)',
    );
    expect(rows[1].querySelector('[data-guild-presence]')).toBeNull();
    // The legend explains the dot without a hover, and the dot is the social
    // presence family's online dot, not a second green.
    expect(root.querySelector('.gb-legend')?.textContent).toBe('Officers online');
    expect(dot.querySelector('.soc-dot.online')).not.toBeNull();
    // The live count line announces the result of a read to a screen reader.
    expect(root.querySelector('.gb-filter-status')?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.gb-filter-status')?.textContent).toBe('2 guilds shown');
  });

  it('attaches the shared tooltip listing the online officers, Guild Master first', async () => {
    await openAndSettle();

    const dot = root.querySelector('[data-guild-presence]') as HTMLButtonElement;
    const attached = tooltips.find((tip) => tip.el === dot);
    expect(attached).toBeDefined();
    const html = attached?.html() ?? '';
    expect(html).toContain('<div class="tt-title">Officers online</div>');
    const lines = [
      ...html.matchAll(
        /gb-rank-(leader|officer)">([^<]+)<\/span><span class="gb-presence-name">([^<]+)</g,
      ),
    ];
    expect(lines.map((m) => [m[1], m[2], m[3]])).toEqual([
      ['leader', 'Guild Master', 'Boss'],
      ['officer', 'Officer', 'Right Hand'],
    ]);
  });

  it('escapes a hostile officer name in the tooltip and the accessible label', async () => {
    world = fakeWorld({
      guildLeaderboard: async () =>
        pageOf([
          {
            ...STORMCALLERS,
            onlineOfficers: [{ name: '<img src=x onerror=alert(1)>', rank: 'officer' }],
          },
        ]),
    } as never);
    await openAndSettle();

    const dot = root.querySelector('[data-guild-presence]') as HTMLButtonElement;
    expect(dot.querySelector('img')).toBeNull();
    expect(dot.getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)> (Officer)');
    const html = tooltips.find((tip) => tip.el === dot)?.html() ?? '';
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows no dot and no chip on a pre-category server row (fields absent)', async () => {
    world = fakeWorld({
      guildLeaderboard: async () =>
        pageOf([{ rank: 1, name: 'Old', memberCount: 1, totalLifetimeXp: 10, topLevel: 1 }]),
    } as never);
    await openAndSettle();

    expect(root.querySelector('[data-guild-presence]')).toBeNull();
    expect(root.querySelector('.gb-tag-new-players')).toBeNull();
    expect(tooltips).toHaveLength(0);
  });
});
