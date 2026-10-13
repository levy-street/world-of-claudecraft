import { describe, expect, it } from 'vitest';
import {
  buildRecruitmentView,
  type RecruitmentDraft,
} from '../src/ui/hud/expeditions/recruitment_view';
import type { DungeonFinderInfo } from '../src/world_api/dungeon_finder';
import type { PartyInfo } from '../src/world_api/party';

const draft: RecruitmentDraft = {
  dungeonId: 'hollow_crypt',
  difficulty: 'normal',
  role: 'tank',
  purpose: 'clear',
  note: '',
};
const info = () =>
  ({
    roles: ['tank'],
    eligibleRoles: ['tank', 'dps'],
    queue: null,
    proposal: null,
    myListing: null,
    myApplication: null,
    cooldown: 0,
  }) as DungeonFinderInfo;

describe('compact recruitment eligibility', () => {
  it('chooses an eligible dungeon, difficulty and role from authoritative choices', () => {
    const view = buildRecruitmentView(info(), null, 1, 8, {
      ...draft,
      dungeonId: 'invalid',
      role: 'healer',
      difficulty: 'heroic',
    });
    expect(view.blocked).toBeNull();
    expect(view.activity?.dungeonId).toBe(view.dungeonId);
    expect(view.activity?.difficulty).toBe('normal');
    expect(view.role).toBe('tank');
    expect(view.roles).not.toContain('healer');
  });
  it('checks every member level and spare capacity', () => {
    const party = {
      leader: 1,
      members: [
        { pid: 1, level: 8 },
        { pid: 2, level: 60 },
      ],
    } as PartyInfo;
    expect(buildRecruitmentView(info(), party, 1, 8, draft).blocked).toBe('activity');
    party.members = Array.from({ length: 5 }, (_, pid) => ({
      pid,
      level: 8,
    })) as PartyInfo['members'];
    expect(buildRecruitmentView(info(), party, 1, 8, draft).blocked).toBe('activity');
  });
  it.each(['queue', 'proposal', 'myListing', 'expedition'] as const)(
    'does not replace an existing %s',
    (field) => {
      const state = info();
      Object.assign(state, { [field]: {} });
      expect(buildRecruitmentView(state, null, 1, 8, draft).blocked).not.toBeNull();
    },
  );
  it('blocks non-leaders, pending applications and invalid notes before publication', () => {
    const state = info();
    const party = { leader: 2, members: [{ pid: 1, level: 8 }] } as PartyInfo;
    expect(buildRecruitmentView(state, party, 1, 8, draft).blocked).toBe('leader');
    state.myApplications = [{ listingId: 4 }];
    expect(buildRecruitmentView(state, null, 1, 8, draft).blocked).toBe('application');
    state.myApplications = [];
    expect(
      buildRecruitmentView(state, null, 1, 8, { ...draft, note: 'x'.repeat(121) }).blocked,
    ).toBe('note');
    expect(buildRecruitmentView(state, null, 1, 8, { ...draft, note: 'bad\u0000' }).blocked).toBe(
      'note',
    );
  });
});
