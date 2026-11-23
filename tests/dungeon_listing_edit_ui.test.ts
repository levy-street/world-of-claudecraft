// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Role } from '../src/sim/content/talents';
import { premadeBoardHtml } from '../src/ui/dungeon_board_chrome';
import { createGroupFormHtml, publishGroupDraft } from '../src/ui/dungeon_create_form';
import {
  buildDungeonFinderView,
  type DungeonFinderViewInput,
  type FinderQueuePanelView,
} from '../src/ui/dungeon_finder_view';
import type { IWorld } from '../src/world_api';

const roster = (youngLevel: number) => [
  { pid: 1, name: 'Lead', cls: 'warrior' as const, level: 20 },
  { pid: 2, name: 'Mender', cls: 'priest' as const, level: 20 },
  { pid: 3, name: 'Spark', cls: 'mage' as const, level: youngLevel },
];

function input(over: Partial<DungeonFinderViewInput> = {}): DungeonFinderViewInput {
  return {
    info: {
      roles: ['tank'],
      eligibleRoles: ['tank', 'dps'],
      queue: null,
      cooldown: 0,
      proposal: null,
      myApplication: null,
      myListing: {
        id: 9,
        activityId: 'gravewyrm_sanctum_normal',
        tags: [],
        applicants: [],
        partyRoles: [{ pid: 2, role: 'healer' }],
      },
    },
    board: [],
    playerLevel: 20,
    playerClass: 'warrior',
    playerId: 1,
    specRole: null,
    party: { leader: 1, size: 3, members: roster(20) },
    partyLeaderName: 'Lead',
    lockouts: [],
    tab: 'board',
    selectedActivityId: null,
    stagedActivityIds: [],
    ...over,
  };
}
function live(over: Partial<DungeonFinderViewInput> = {}) {
  const view = buildDungeonFinderView(input(over));
  if (view.kind !== 'live') throw new Error('expected a live view');
  return view;
}
function markup(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('view model: party members and the difficulty switch', () => {
  it('lists the other party members with their class roles and my assignment', () => {
    const { board } = live();
    expect(board.partyMembers).toEqual([
      {
        pid: 2,
        name: 'Mender',
        cls: 'priest',
        level: 20,
        roles: ['healer', 'dps'],
        assigned: 'healer',
      },
      { pid: 3, name: 'Spark', cls: 'mage', level: 20, roles: ['dps'], assigned: null },
    ]);
    // A non-leader member gets no pickers; the leader manages the roster.
    expect(live({ playerId: 2 }).board.partyMembers).toEqual([]);
    // An open expedition seats by its own roster roles: no pickers there.
    const base = input();
    const expedition = {
      exitId: 1,
      activityId: 'gravewyrm_sanctum_normal',
      dungeonId: 'gravewyrm_sanctum',
      leaderPid: 1,
      isLeader: true,
      isInside: true,
      canTravel: false,
      open: true,
      bossesDefeated: 1,
      bossesTotal: 4,
    };
    expect(live({ info: { ...base.info!, expedition } }).board.partyMembers).toEqual([]);
  });

  it('offers Normal and Heroic in catalogue order, gating Heroic on every member level', () => {
    expect(live().board.difficultyOptions).toEqual([
      { id: 'gravewyrm_sanctum_normal', difficulty: 'normal', current: true, eligible: true },
      { id: 'gravewyrm_sanctum_heroic', difficulty: 'heroic', current: false, eligible: true },
    ]);
    const young = live({ party: { leader: 1, size: 3, members: roster(19) } });
    expect(young.board.difficultyOptions[1]).toMatchObject({ eligible: false });
    // Content with no other difficulty, or no listing at all, has no switch.
    const base = input();
    const solo = live({
      info: {
        ...base.info!,
        myListing: { id: 9, activityId: 'nythraxis_crypt_normal', tags: [], applicants: [] },
      },
    });
    expect(solo.board.difficultyOptions).toEqual([]);
    expect(live({ info: { ...base.info!, myListing: null } }).board.difficultyOptions).toEqual([]);
  });

  it('rebuilds when an assignment or the difficulty options change', () => {
    const base = input();
    const before = live().sig;
    const after = live({
      info: {
        ...base.info!,
        myListing: { ...base.info!.myListing!, partyRoles: [{ pid: 2, role: 'dps' }] },
      },
    }).sig;
    expect(after).not.toBe(before);
  });
});

describe('markup: my listing and the create form', () => {
  it('renders the difficulty switch and the role pickers on my listing', () => {
    const { board } = live();
    const root = markup(premadeBoardHtml(board, ''));
    const normal = root.querySelector<HTMLButtonElement>(
      '[data-listing-difficulty="gravewyrm_sanctum_normal"]',
    );
    const heroic = root.querySelector<HTMLButtonElement>(
      '[data-listing-difficulty="gravewyrm_sanctum_heroic"]',
    );
    expect(normal?.disabled).toBe(true);
    expect(normal?.getAttribute('aria-pressed')).toBe('true');
    expect(heroic?.disabled).toBe(false);
    expect(heroic?.textContent).toBe('Heroic');
    expect(root.querySelector('.df-party-roles h3')?.textContent).toBe('Party roles');
    expect(root.querySelector<HTMLSelectElement>('[data-party-role="2"]')?.value).toBe('healer');
    const spark = root.querySelector<HTMLSelectElement>('[data-party-role="3"]');
    expect(spark?.value).toBe('');
    expect([...(spark?.options ?? [])].map((o) => o.value)).toEqual(['', 'dps']);
    expect(spark?.getAttribute('aria-label')).toBe('Role for Spark');
  });

  it('shows the staged roles in the create form before the listing exists', () => {
    const base = input();
    const { board } = live({ info: { ...base.info!, myListing: null } });
    const queue = { roles: [], queued: false, proposal: null } as unknown as FinderQueuePanelView;
    const root = markup(
      createGroupFormHtml(board, queue, {
        kind: 'dungeon',
        activity: null,
        role: null,
        tags: new Set(),
        guildOnly: false,
        partyRoles: new Map<number, Role>([[3, 'dps']]),
      }),
    );
    expect(root.querySelector('.df-party-roles h3')?.textContent).toBe('Bringing your party');
    expect(root.querySelector<HTMLSelectElement>('[data-party-role="2"]')?.value).toBe('');
    expect(root.querySelector<HTMLSelectElement>('[data-party-role="3"]')?.value).toBe('dps');
  });
});

describe('publishGroupDraft: the party roles follow the create', () => {
  it('sends roles, then the listing, then the assignments for current members only', () => {
    const calls: unknown[] = [];
    const world = {
      dungeonFinderInfo: { myListing: null, queue: null, proposal: null },
      partyInfo: { leader: 1, members: roster(20) },
      playerId: 1,
      player: { level: 20 },
      cfg: { playerClass: 'warrior' },
      talentRole: null,
      dungeonFinderSetRoles: (roles: Role[]) => calls.push(['roles', roles]),
      dungeonFinderListingCreate: (id: string) => calls.push(['create', id]),
      dungeonFinderExpeditionConfigure: (settings: unknown) => calls.push(['configure', settings]),
    } as unknown as IWorld;
    const roles = new Map<number, Role>([
      [2, 'healer'],
      [99, 'dps'],
    ]);
    expect(publishGroupDraft(world, 'hollow_crypt_normal', 'tank', new Set(), roles)).toBe(false);
    expect(publishGroupDraft(world, 'gravewyrm_sanctum_normal', 'tank', new Set(), roles)).toBe(
      true,
    );
    expect(calls).toEqual([
      ['roles', ['tank']],
      ['create', 'gravewyrm_sanctum_normal'],
      ['configure', { kind: 'party_roles', roles: [{ pid: 2, role: 'healer' }] }],
    ]);
    calls.length = 0;
    publishGroupDraft(world, 'gravewyrm_sanctum_normal', 'tank', new Set());
    expect(calls.map((c) => (c as unknown[])[0])).toEqual(['roles', 'create']);
  });
});
