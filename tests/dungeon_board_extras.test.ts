// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FINDER_GUILD_TAG } from '../src/sim/content/dungeon_finder';
import {
  boardApplicantHtml,
  boardListingHtml,
  premadeBoardHtml,
} from '../src/ui/dungeon_board_chrome';
import { filterBoardListings, isBoardContentFilter } from '../src/ui/dungeon_board_filter';
import { createGroupFormHtml } from '../src/ui/dungeon_create_form';
import {
  buildDungeonFinderView,
  type FinderBoardPanelView,
  type FinderListingRowView,
  type FinderQueuePanelView,
} from '../src/ui/dungeon_finder_view';

const listing: FinderListingRowView = {
  id: 7,
  activityId: 'hollow_crypt_normal',
  dungeonId: 'hollow_crypt',
  difficulty: 'normal',
  kind: 'dungeon',
  leaderName: 'Leader',
  tags: [],
  size: 2,
  capacity: 5,
  needed: { tank: 0, healer: 1, dps: 2 },
  members: [{ cls: 'warrior', level: 8, role: 'tank' }],
  mine: false,
  applied: false,
  canApply: true,
  applicationRole: null,
  blocked: null,
  guildLocked: false,
};
const raid: FinderListingRowView = { ...listing, id: 8, kind: 'raid' };
const panel = (over: Partial<FinderBoardPanelView> = {}): FinderBoardPanelView => ({
  listings: [listing, raid],
  myListing: null,
  myApplicationListingId: null,
  canCreate: true,
  createGate: null,
  createOptions: [],
  tags: [],
  guild: '',
  advert: null,
  partyMembers: [],
  difficultyOptions: [],
  ...over,
});
function markup(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('board content-type filter', () => {
  it('keeps every row for all, and only the chosen kind otherwise', () => {
    expect(filterBoardListings([listing, raid], 'all').map((r) => r.id)).toEqual([7, 8]);
    expect(filterBoardListings([listing, raid], 'dungeon').map((r) => r.id)).toEqual([7]);
    expect(filterBoardListings([listing, raid], 'raid').map((r) => r.id)).toEqual([8]);
    expect(isBoardContentFilter('raid')).toBe(true);
    expect(isBoardContentFilter('delve')).toBe(false);
  });

  it('renders the filter select and a filter-specific empty state', () => {
    const root = markup(premadeBoardHtml(panel(), '', '', '', undefined, 'raid', []));
    expect(
      root.querySelector<HTMLOptionElement>('[data-board-filter] option[selected]')?.value,
    ).toBe('raid');
    expect(root.querySelector('.df-listings')?.textContent).toContain('No listings match');
    expect(root.querySelectorAll('.df-listing')).toHaveLength(0);
  });
});

describe('Guild Parties in the board UI', () => {
  it('badges a Guild Party, notes it, and locks Apply for outsiders', () => {
    const guildRow = {
      ...listing,
      tags: [FINDER_GUILD_TAG],
      guild: 'Nightwatch',
      guildLocked: true,
      canApply: false,
    };
    const row = markup(boardListingHtml(guildRow));
    expect(row.querySelector('.df-guild-chip')?.textContent).toContain('Nightwatch');
    const apply = row.querySelector<HTMLButtonElement>('[data-apply]');
    expect(apply?.disabled).toBe(true);
    expect(apply?.textContent).toBe('Guild members only');
    // The flag is a badge, never a purpose chip.
    expect(row.querySelector('.df-listing-tags')?.textContent).toBe('');
    const board = markup(premadeBoardHtml(panel({ listings: [guildRow] }), ''));
    expect(board.querySelector('.df-guild-note')).not.toBeNull();
    expect(markup(premadeBoardHtml(panel(), '')).querySelector('.df-guild-note')).toBeNull();
  });

  it('derives guildLocked from my guild: a guildmate may apply, others may not', () => {
    const input = {
      info: {
        roles: ['dps' as const],
        eligibleRoles: ['dps' as const],
        queue: null,
        cooldown: 0,
        proposal: null,
        myListing: null,
        myApplication: null,
      },
      board: [
        {
          id: 3,
          activityId: 'hollow_crypt_normal',
          leaderName: 'Leader',
          tags: [FINDER_GUILD_TAG],
          guild: 'Nightwatch',
          size: 1,
          capacity: 5,
          needed: { tank: 1, healer: 1, dps: 3 },
          members: [{ cls: 'warrior' as const, level: 8, role: 'tank' as const }],
        },
      ],
      playerLevel: 8,
      playerClass: 'warrior' as const,
      playerId: 1,
      specRole: null,
      party: null,
      partyLeaderName: null,
      lockouts: [],
      tab: 'board' as const,
      selectedActivityId: null,
      stagedActivityIds: [],
    };
    const rowFor = (playerGuild: string) => {
      const view = buildDungeonFinderView({ ...input, playerGuild });
      if (view.kind !== 'live') throw new Error('expected a live view');
      return view.board.listings[0];
    };
    expect(rowFor('Nightwatch')).toMatchObject({ guildLocked: false, canApply: true });
    expect(rowFor('Other')).toMatchObject({ guildLocked: true, canApply: false });
    expect(rowFor('')).toMatchObject({ guildLocked: true, canApply: false });
  });

  it('offers the Guild Party toggle only to a guilded leader, with a note either way', () => {
    const queue = { roles: [], queued: false, proposal: null } as unknown as FinderQueuePanelView;
    const draft = {
      kind: 'dungeon' as const,
      activity: null,
      role: null,
      tags: new Set<never>(),
      guildOnly: true,
      partyRoles: new Map(),
    };
    const guilded = markup(createGroupFormHtml(panel({ guild: 'Nightwatch' }), queue, draft));
    const toggle = guilded.querySelector<HTMLInputElement>('[data-create-guild]');
    expect(toggle?.disabled).toBe(false);
    expect(toggle?.checked).toBe(true);
    expect(guilded.querySelector('.df-create-guild')?.textContent).toContain(
      'Only members of Nightwatch',
    );
    const loner = markup(createGroupFormHtml(panel(), queue, draft));
    expect(loner.querySelector<HTMLInputElement>('[data-create-guild]')?.disabled).toBe(true);
    expect(loner.querySelector<HTMLInputElement>('[data-create-guild]')?.checked).toBe(false);
    expect(loner.querySelector('.df-create-guild')?.textContent).toContain('Join a guild');
  });
});

describe('leader tools: adverts and applicant inspect', () => {
  const mine = {
    id: 7,
    activityId: 'hollow_crypt_normal',
    tags: [],
    applicants: [],
    advertText: 'LFM - The Hollow Crypt - Normal - 1/5 - Healer/DPS needed',
  };

  it('previews the line and greys out a cooling or offline target with its reason', () => {
    const root = markup(
      premadeBoardHtml(
        panel({ myListing: mine, advert: { general: 3, discord: 0, discordAvailable: false } }),
        '',
      ),
    );
    expect(root.querySelector('.df-advert-preview')?.textContent).toBe(mine.advertText);
    const general = root.querySelector<HTMLButtonElement>('[data-advert="general"]');
    const discord = root.querySelector<HTMLButtonElement>('[data-advert="discord"]');
    expect(general?.disabled).toBe(true);
    expect(general?.textContent).toContain('Ready in 3 min');
    expect(discord?.disabled).toBe(true);
    expect(discord?.textContent).toContain('Online play only');
    const ready = markup(
      premadeBoardHtml(
        panel({ myListing: mine, advert: { general: 0, discord: 0, discordAvailable: true } }),
        '',
      ),
    );
    expect(ready.querySelector<HTMLButtonElement>('[data-advert="general"]')?.disabled).toBe(false);
    expect(ready.querySelector<HTMLButtonElement>('[data-advert="discord"]')?.disabled).toBe(false);
    // No advert section without the sim-built line.
    const bare = markup(
      premadeBoardHtml(panel({ myListing: { ...mine, advertText: undefined } }), ''),
    );
    expect(bare.querySelector('[data-advert]')).toBeNull();
  });

  it('gives every applicant an Inspect button keyed by pid', () => {
    const root = markup(
      boardApplicantHtml({
        pid: 12,
        name: 'Ayla',
        cls: 'priest',
        spec: null,
        level: 8,
        roles: ['healer'],
      }),
    );
    const inspect = root.querySelector('[data-appinspect="12"]');
    expect(inspect?.textContent).toContain('Inspect');
    expect(inspect?.getAttribute('aria-label')).toBe('Inspect Ayla');
  });
});
