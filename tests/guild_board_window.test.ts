// @vitest-environment happy-dom
//
// The signpost guild board window: the ranked board with pledge affordances
// (the surface the leaderboard's guilds tab used to carry), the note's soft
// profanity mask, and the per-guild roster drill-in (Guild Master, then
// officers, then members, each rank tier ranked by lifetime XP).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuildBoardWindow, type GuildBoardWindowDeps } from '../src/ui/hud/guild_board';
import type { GuildLeaderboardPage, GuildRosterInfo, IWorld } from '../src/world_api';

const PAGE: GuildLeaderboardPage = {
  leaders: [
    {
      rank: 1,
      name: 'Stormcallers',
      memberCount: 12,
      totalLifetimeXp: 2_500_000,
      topLevel: 20,
      pledgesOpen: true,
      pledgeMinLevel: 10,
      pledgeNote: 'we love grog',
    },
    {
      rank: 2,
      name: 'Gatekept',
      memberCount: 2,
      totalLifetimeXp: 50_000,
      topLevel: 12,
      pledgesOpen: false,
    },
  ],
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

  function deps(overrides: Partial<GuildBoardWindowDeps> = {}): GuildBoardWindowDeps {
    return {
      root: () => root,
      world: () => world,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      maskPlayerText: (text) => text.replace(/grog/g, '****'),
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="guild-board-window" class="window panel"></div>';
    root = document.getElementById('guild-board-window') as HTMLElement;
    pledged = [];
    world = fakeWorld({ guildPledge: (name: string) => void pledged.push(name) } as never);
    win = new GuildBoardWindow(deps());
  });

  afterEach(() => {
    win.close();
    document.body.innerHTML = '';
  });

  async function openAndSettle(): Promise<void> {
    win.open();
    await vi.waitFor(() => {
      if (!root.querySelector('.lb-row-guild, .lb-empty, .lb-error')) throw new Error('pending');
    });
  }

  it('opens on the ranked board with status, floor, masked note, and a Pledge button', async () => {
    // Act
    await openAndSettle();

    // Assert
    const rows = [...root.querySelectorAll('.lb-guild-entry')];
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(first.querySelector('.lb-name')?.textContent).toBe('Stormcallers');
    expect(first.querySelector('.lb-name')?.classList.contains('guild-tier-2')).toBe(true);
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
      guildLeaderboard: async () => ({
        leaders: [],
        page: 0,
        pageCount: 1,
        total: 0,
        pageSize: 20,
      }),
      socialInfo: null,
    } as never);

    // Act
    await openAndSettle();

    // Assert
    expect(root.querySelector('.lb-empty')?.textContent).toBe('Nothing seems posted.');
  });
});
