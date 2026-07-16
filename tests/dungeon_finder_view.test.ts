// Pure-core coverage for src/ui/dungeon_finder_view.ts: same-shape parity for
// Sim-shaped and ClientWorld-shaped inputs, catalogue/queue/board derivation,
// and render-skip signature stability (clocks stay OUTSIDE the signature).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import {
  buildDungeonFinderView,
  buildFinderProposalPopupView,
  type DungeonFinderViewInput,
  FINDER_PORTRAIT_DIR,
} from '../src/ui/dungeon_finder_view';
import type { DungeonFinderInfo } from '../src/world_api';

function makeInfo(
  shape: 'sim' | 'client',
  over: Partial<DungeonFinderInfo> = {},
): DungeonFinderInfo {
  const base: DungeonFinderInfo = {
    roles: ['tank'],
    eligibleRoles: ['tank', 'dps'],
    queue: null,
    cooldown: 0,
    proposal: null,
    myListing: null,
    myApplication: null,
  };
  const info = { ...base, ...over };
  // A ClientWorld mirror decodes from JSON and may carry extra wire fields the
  // core must ignore.
  if (shape === 'client') {
    return JSON.parse(JSON.stringify({ ...info, junk: 1, wireOnly: 'x' })) as DungeonFinderInfo;
  }
  return info;
}

function input(over: Partial<DungeonFinderViewInput> = {}): DungeonFinderViewInput {
  return {
    info: makeInfo('sim'),
    board: [],
    playerLevel: 8,
    playerClass: 'warrior',
    playerId: 1,
    specRole: null,
    party: null,
    lockouts: [],
    tab: 'catalogue',
    selectedActivityId: null,
    stagedActivityIds: [],
    ...over,
  };
}

function live(view: ReturnType<typeof buildDungeonFinderView>) {
  if (view.kind !== 'live') throw new Error('expected live view');
  return view;
}

describe('dungeon finder view core', () => {
  it('renders the loading state only when the online mirror has not synced', () => {
    expect(buildDungeonFinderView(input({ info: null })).kind).toBe('loading');
    expect(buildDungeonFinderView(input()).kind).toBe('live');
  });

  it('produces the same view for Sim-shaped and ClientWorld-shaped inputs', () => {
    const fromSim = buildDungeonFinderView(input({ info: makeInfo('sim') }));
    const fromClient = buildDungeonFinderView(input({ info: makeInfo('client') }));
    expect(fromClient).toEqual(fromSim);
  });

  it('is deterministic: identical input yields an identical view and signature', () => {
    const a = live(buildDungeonFinderView(input()));
    const b = live(buildDungeonFinderView(input()));
    expect(b).toEqual(a);
    expect(b.sig).toBe(a.sig);
  });

  it('lists every catalogued activity with strict level eligibility', () => {
    const view = live(buildDungeonFinderView(input({ playerLevel: 8 })));
    expect(view.rows.map((r) => r.id)).toEqual(FINDER_ACTIVITIES.map((a) => a.id));
    const byId = new Map(view.rows.map((r) => [r.id, r]));
    expect(byId.get('hollow_crypt_normal')?.eligible).toBe(true);
    expect(byId.get('sunken_bastion_normal')?.blocked).toBe('level');
    expect(byId.get('nythraxis_boss_arena_normal')?.blocked).toBe('level');
  });

  it('flags the missing-spec gate at level 10+ and closes Quick Match', () => {
    const view = live(buildDungeonFinderView(input({ playerLevel: 20, specRole: null })));
    expect(view.queue.needsSpec).toBe(true);
    expect(view.rows.find((r) => r.id === 'hollow_crypt_heroic')?.blocked).toBe('spec');
  });

  it('selects the first activity by default and honors an explicit selection', () => {
    const dflt = live(buildDungeonFinderView(input()));
    expect(dflt.detail?.id).toBe(FINDER_ACTIVITIES[0].id);
    const picked = live(
      buildDungeonFinderView(input({ selectedActivityId: 'nythraxis_boss_arena_heroic' })),
    );
    expect(picked.detail?.id).toBe('nythraxis_boss_arena_heroic');
    expect(picked.detail?.composition).toEqual({ tank: 2, healer: 2, dps: 6 });
    expect(picked.detail?.attunementQuestId).toBe('q_nythraxis_bound_guardian');
    expect(picked.detail?.heroicMarks).toBe(3);
  });

  it('builds encounter previews with portraits, mechanics, and loot groups', () => {
    const view = live(buildDungeonFinderView(input({ selectedActivityId: 'hollow_crypt_normal' })));
    const boss = view.detail?.encounters.find((e) => e.final);
    expect(boss?.mobId).toBe('morthen');
    expect(boss?.portraitUrl).toBe('/ui/dungeons/morthen.webp');
    expect(boss?.mechanics).toEqual(['shadow_pulse']);
    expect(boss?.groups.length).toBeGreaterThan(0);
    // morthen_guaranteed_uncommon partitions a full draw; morthen_bonus sums
    // below 1 and must NOT claim a guaranteed drop.
    expect(boss?.groups[0].guaranteed).toBe(true);
    expect(boss?.groups[1].guaranteed).toBe(false);
    expect(boss?.copper).toBeGreaterThan(0);
    expect(boss?.heroicGroups).toEqual([]);
    // Attunement quest drops never appear in the preview.
    const crypt = live(
      buildDungeonFinderView(
        input({
          playerLevel: 20,
          specRole: 'dps',
          playerClass: 'mage',
          selectedActivityId: 'nythraxis_crypt_normal',
        }),
      ),
    );
    for (const enc of crypt.detail?.encounters ?? []) {
      for (const g of enc.groups)
        for (const i of g.items)
          expect(i.itemId).not.toMatch(/captains_crest|priests_sigil|royal_seal/);
      for (const i of enc.singles)
        expect(i.itemId).not.toMatch(/captains_crest|priests_sigil|royal_seal/);
    }
  });

  it('appends heroic-only loot groups on heroic difficulty', () => {
    const view = live(
      buildDungeonFinderView(
        input({
          playerLevel: 20,
          specRole: 'tank',
          selectedActivityId: 'hollow_crypt_heroic',
        }),
      ),
    );
    const boss = view.detail?.encounters.find((e) => e.final);
    expect(boss?.heroicGroups.length).toBe(2);
    expect(boss?.heroicGroups.every((g) => g.guaranteed)).toBe(true);
    expect(view.detail?.heroicMarks).toBe(1);
  });

  it('maps raid entrances to the Abandoned Crypt door with its zone', () => {
    const view = live(
      buildDungeonFinderView(
        input({
          playerLevel: 20,
          specRole: 'dps',
          selectedActivityId: 'nythraxis_boss_arena_normal',
        }),
      ),
    );
    expect(view.detail?.entrance.x).toBe(-152);
    expect(view.detail?.entrance.z).toBe(610);
    expect(view.detail?.entrance.zoneId.length).toBeGreaterThan(0);
  });

  it('surfaces my lockout on the matching difficulty only (minute granularity)', () => {
    const view = live(
      buildDungeonFinderView(
        input({
          playerLevel: 20,
          specRole: 'tank',
          lockouts: [{ id: 'hollow_crypt:heroic', msRemaining: 3_600_000 }],
        }),
      ),
    );
    const byId = new Map(view.rows.map((r) => [r.id, r]));
    expect(byId.get('hollow_crypt_heroic')?.lockedMinutes).toBe(60);
    expect(byId.get('hollow_crypt_normal')?.lockedMinutes).toBe(0);
  });

  it('derives Quick Match state: staged checklist, leader gate, and canQueue', () => {
    const staged = live(
      buildDungeonFinderView(input({ tab: 'queue', stagedActivityIds: ['hollow_crypt_normal'] })),
    );
    expect(staged.queue.options.find((o) => o.id === 'hollow_crypt_normal')?.checked).toBe(true);
    expect(staged.queue.canQueue).toBe(true);
    // A non-leader party member cannot queue.
    const member = live(
      buildDungeonFinderView(
        input({
          tab: 'queue',
          stagedActivityIds: ['hollow_crypt_normal'],
          party: { leader: 99, size: 2 },
        }),
      ),
    );
    expect(member.queue.isLeader).toBe(false);
    expect(member.queue.canQueue).toBe(false);
    // While queued, the live selection wins over the staged checklist.
    const queued = live(
      buildDungeonFinderView(
        input({
          tab: 'queue',
          info: makeInfo('sim', { queue: { activities: ['hollow_crypt_normal'], waited: 42 } }),
        }),
      ),
    );
    expect(queued.queue.queued).toBe(true);
    expect(queued.queue.canQueue).toBe(false);
    expect(queued.clocks.queueWaited).toBe(42);
  });

  it('exposes the proposal panel plus its clock fields', () => {
    const view = live(
      buildDungeonFinderView(
        input({
          info: makeInfo('sim', {
            proposal: {
              id: 3,
              activityId: 'hollow_crypt_normal',
              role: 'tank',
              size: 5,
              accepted: 2,
              acceptedByRole: { tank: 0, healer: 0, dps: 2 },
              myResponse: 'pending',
              remaining: 21,
            },
          }),
        }),
      ),
    );
    expect(view.queue.proposal?.dungeonId).toBe('hollow_crypt');
    expect(view.queue.proposal?.myResponse).toBe('pending');
    expect(view.clocks.proposalRemaining).toBe(21);
    expect(view.clocks.proposalAccepted).toBe(2);
  });

  it('annotates board listings with apply eligibility and role fit', () => {
    const listing = {
      id: 7,
      activityId: 'hollow_crypt_normal',
      leaderName: 'Lead',
      tags: ['first_run' as const],
      size: 1,
      capacity: 5,
      needed: { tank: 0, healer: 1, dps: 3 },
      members: [{ cls: 'warrior' as const, level: 8, role: 'tank' as const }],
    };
    // A tank-only viewer cannot fill the open slots.
    const tankView = live(buildDungeonFinderView(input({ tab: 'board', board: [listing] })));
    expect(tankView.board.listings[0].canApply).toBe(false);
    // A dps-capable viewer can.
    const dpsView = live(
      buildDungeonFinderView(
        input({
          tab: 'board',
          board: [listing],
          info: makeInfo('sim', { roles: ['dps'], eligibleRoles: ['dps'] }),
          playerClass: 'mage',
        }),
      ),
    );
    expect(dpsView.board.listings[0].canApply).toBe(true);
    // Already applied elsewhere: no second application.
    const applied = live(
      buildDungeonFinderView(
        input({
          tab: 'board',
          board: [listing],
          info: makeInfo('sim', { roles: ['dps'], myApplication: { listingId: 99 } }),
          playerClass: 'mage',
        }),
      ),
    );
    expect(applied.board.listings[0].canApply).toBe(false);
  });

  it('keeps the 1 Hz clock numbers OUT of the render-skip signature', () => {
    const base = input({
      info: makeInfo('sim', {
        queue: { activities: ['hollow_crypt_normal'], waited: 10 },
        cooldown: 0,
        proposal: {
          id: 3,
          activityId: 'hollow_crypt_normal',
          role: 'tank',
          size: 5,
          accepted: 1,
          acceptedByRole: { tank: 0, healer: 0, dps: 1 },
          myResponse: 'accepted',
          remaining: 20,
        },
      }),
    });
    const a = live(buildDungeonFinderView(base));
    const ticked = live(
      buildDungeonFinderView({
        ...base,
        info: makeInfo('sim', {
          queue: { activities: ['hollow_crypt_normal'], waited: 11 },
          cooldown: 0,
          proposal: {
            id: 3,
            activityId: 'hollow_crypt_normal',
            role: 'tank',
            size: 5,
            accepted: 2,
            acceptedByRole: { tank: 0, healer: 0, dps: 2 },
            myResponse: 'accepted',
            remaining: 19,
          },
        }),
      }),
    );
    expect(ticked.sig).toBe(a.sig);
    expect(ticked.clocks.proposalRemaining).toBe(19);
    // Structural changes DO move the signature.
    const roleFlip = live(
      buildDungeonFinderView({
        ...base,
        info: makeInfo('sim', { roles: ['tank', 'dps'] }),
      }),
    );
    expect(roleFlip.sig).not.toBe(a.sig);
    const tabFlip = live(buildDungeonFinderView({ ...base, tab: 'board' }));
    expect(tabFlip.sig).not.toBe(a.sig);
  });
});

describe('proposal popup view', () => {
  const proposal = {
    id: 9,
    activityId: 'hollow_crypt_normal',
    role: 'healer' as const,
    size: 5,
    accepted: 3,
    acceptedByRole: { tank: 1, healer: 0, dps: 2 },
    myResponse: 'pending' as const,
    remaining: 17,
  };

  it('is null without a live proposal', () => {
    expect(buildFinderProposalPopupView(null)).toBeNull();
    expect(buildFinderProposalPopupView(makeInfo('sim'))).toBeNull();
  });

  it('builds one meter per role slot with my slot flagged', () => {
    const view = buildFinderProposalPopupView(makeInfo('sim', { proposal }));
    expect(view?.dungeonId).toBe('hollow_crypt');
    expect(view?.slots).toEqual([
      { role: 'tank', total: 1, accepted: 1, mine: false },
      { role: 'healer', total: 1, accepted: 0, mine: true },
      { role: 'dps', total: 3, accepted: 2, mine: false },
    ]);
    expect(view?.myResponse).toBe('pending');
    expect(view?.remaining).toBe(17);
  });

  it('keeps the countdown OUT of the signature but moves it on accepts', () => {
    const a = buildFinderProposalPopupView(makeInfo('sim', { proposal }));
    const ticked = buildFinderProposalPopupView(
      makeInfo('sim', { proposal: { ...proposal, remaining: 16 } }),
    );
    expect(ticked?.sig).toBe(a?.sig);
    const accepted = buildFinderProposalPopupView(
      makeInfo('sim', {
        proposal: { ...proposal, accepted: 4, acceptedByRole: { tank: 1, healer: 1, dps: 2 } },
      }),
    );
    expect(accepted?.sig).not.toBe(a?.sig);
  });
});

// A catalogued encounter with no committed portrait ships a silent 404 in the rail and
// the detail header (the view builds the URL blindly from the mob id), so pin every
// encounter, on both difficulties, against the real files under public/.
describe('every catalogued encounter has a committed portrait', () => {
  it('resolves a webp under public/ui/dungeons for every encounter mob id', () => {
    const missing: string[] = [];
    for (const activity of FINDER_ACTIVITIES) {
      for (const enc of activity.encounters) {
        const file = resolve(process.cwd(), `public${FINDER_PORTRAIT_DIR}/${enc.mobId}.webp`);
        if (!existsSync(file)) missing.push(`${activity.id}: ${enc.mobId}`);
      }
    }
    expect(missing, `catalogued encounters with no portrait webp:\n${missing.join('\n')}`).toEqual(
      [],
    );
  });
});
