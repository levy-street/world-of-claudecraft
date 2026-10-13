import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { createFormState, type GroupDraft } from '../src/ui/dungeon_create_form';
import type { FinderBoardPanelView, FinderQueuePanelView } from '../src/ui/dungeon_finder_view';

const board = {
  canCreate: true,
  createOptions: FINDER_ACTIVITIES.map((a) => ({
    id: a.id,
    dungeonId: a.dungeonId,
    difficulty: a.difficulty,
  })),
} as FinderBoardPanelView;
const queue = {
  roles: [
    { role: 'tank', eligible: false, selected: false },
    { role: 'healer', eligible: true, selected: true },
    { role: 'dps', eligible: true, selected: false },
  ],
  queued: false,
  proposal: null,
} as FinderQueuePanelView;
const draft: GroupDraft = { kind: 'dungeon', activity: null, role: null, tags: new Set() };

describe('group creation draft', () => {
  it('never publishes a hidden activity after switching category', () => {
    const state = createFormState(board, queue, {
      ...draft,
      kind: 'raid',
      activity: 'gravewyrm_sanctum_heroic',
    });
    expect(state.canPublish).toBe(true);
    expect(FINDER_ACTIVITIES.find((a) => a.id === state.activity)?.kind).toBe('raid');
    expect(
      state.options.every((o) => FINDER_ACTIVITIES.find((a) => a.id === o.id)?.kind === 'raid'),
    ).toBe(true);
  });
  it('requires a role for ambiguous preferences, and rejects a staged role that becomes ineligible', () => {
    const ambiguous = { ...queue, roles: queue.roles.map((r) => ({ ...r, selected: r.eligible })) };
    expect(createFormState(board, ambiguous, draft).canPublish).toBe(false);
    expect(createFormState(board, ambiguous, { ...draft, role: 'healer' }).canPublish).toBe(true);
    expect(createFormState(board, queue, { ...draft, role: 'tank' })).toMatchObject({
      role: null,
      canPublish: false,
    });
  });
  it('handles an empty category without selecting an activity from another category', () => {
    const noRaids = {
      ...board,
      createOptions: board.createOptions.filter(
        (o) => FINDER_ACTIVITIES.find((a) => a.id === o.id)?.kind === 'dungeon',
      ),
    };
    expect(createFormState(noRaids, queue, { ...draft, kind: 'raid' })).toMatchObject({
      options: [],
      activity: null,
      canPublish: false,
    });
  });
  it('locks publishing for either matchmaking state and respects loss of leadership', () => {
    expect(createFormState(board, { ...queue, queued: true }, draft).canPublish).toBe(false);
    expect(
      createFormState(
        board,
        { ...queue, proposal: {} as NonNullable<FinderQueuePanelView['proposal']> },
        draft,
      ).canPublish,
    ).toBe(false);
    expect(createFormState({ ...board, canCreate: false }, queue, draft).canPublish).toBe(false);
  });
});
