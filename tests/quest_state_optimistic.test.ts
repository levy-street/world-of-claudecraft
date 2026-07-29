import { describe, expect, it } from 'vitest';
import { optimisticQuestState } from '../src/net/quest_state_optimistic';
import { emptyArchetypeState } from '../src/sim/professions/archetype';
import type { QuestProgress } from '../src/sim/types';

// Issue 1667: talking to an NPC, turning in a quest that gates a follow-up quest,
// should immediately show the follow-up quest in the same dialog session rather
// than requiring the player to close and reopen the dialog. Online, `turnInQuest`
// is a fire-and-forget wire command: the questLog/questsDone mirror only updates
// once the next server snapshot round-trips, so a naive `questState()` read for
// the follow-up quest right after the turn-in click would still see the
// prerequisite as not-done.
describe('optimisticQuestState (issue 1667)', () => {
  it('reports a requiresQuest follow-up as available immediately after the prerequisite turn-in is sent', () => {
    // q_greyjaw requires q_wolves (src/sim/content/zone1.ts). Simulate: q_wolves
    // was just turned in (still in questLog as 'ready' until the snapshot lands,
    // with a pending 'turnin' command recorded), q_greyjaw has never been touched.
    const questLog = new Map<string, QuestProgress>([
      ['q_wolves', { questId: 'q_wolves', counts: [8], state: 'ready' }],
    ]);
    const questsDone = new Set<string>(); // server hasn't confirmed q_wolves done yet
    const pendingQuestCommands = new Map<string, 'accept' | 'turnin'>([['q_wolves', 'turnin']]);

    expect(optimisticQuestState('q_greyjaw', questLog, questsDone, pendingQuestCommands, 5)).toBe(
      'available',
    );
  });

  it('still shows the just-turned-in quest itself as active, not done, while its command is pending', () => {
    const questLog = new Map<string, QuestProgress>([
      ['q_wolves', { questId: 'q_wolves', counts: [8], state: 'ready' }],
    ]);
    const questsDone = new Set<string>();
    const pendingQuestCommands = new Map<string, 'accept' | 'turnin'>([['q_wolves', 'turnin']]);

    expect(optimisticQuestState('q_wolves', questLog, questsDone, pendingQuestCommands, 5)).toBe(
      'active',
    );
  });

  it('falls back to plain computeQuestState once the pending command is cleared (post-snapshot)', () => {
    const questLog = new Map<string, QuestProgress>();
    const questsDone = new Set<string>(['q_wolves']);
    const pendingQuestCommands = new Map<string, 'accept' | 'turnin'>();

    expect(optimisticQuestState('q_greyjaw', questLog, questsDone, pendingQuestCommands, 5)).toBe(
      'available',
    );
  });

  it('does not optimistically unlock a follow-up quest with no pending turn-in for its prerequisite', () => {
    const questLog = new Map<string, QuestProgress>();
    const questsDone = new Set<string>();
    const pendingQuestCommands = new Map<string, 'accept' | 'turnin'>();

    expect(optimisticQuestState('q_greyjaw', questLog, questsDone, pendingQuestCommands, 5)).toBe(
      'unavailable',
    );
  });
});

// The optional `withinCadence` param is the online client's mirror of
// the server-computed work-order cooldown set (cprof), and the attunePair busy
// gate (one pending identity transition at a time) flows through the same
// shared computeQuestState. Both are pinned here at the optimistic seam because
// this is the exact function the gossip dialog re-queries between a click and
// the next snapshot.
describe('optimisticQuestState (cadence + attunement busy gate)', () => {
  const noPending = () => new Map<string, 'accept' | 'turnin'>();

  it('reports a repeatable work order inside its mirrored cadence window as unavailable', () => {
    const questLog = new Map<string, QuestProgress>();
    const questsDone = new Set<string>(['q_prof_workorder_forge']); // repeatable: done never sticks
    const withinCadence = new Set(['q_prof_workorder_forge']);

    expect(
      optimisticQuestState(
        'q_prof_workorder_forge',
        questLog,
        questsDone,
        noPending(),
        5,
        undefined,
        withinCadence,
      ),
    ).toBe('unavailable');
  });

  it('keeps the work order available when the cadence set is absent or names another quest', () => {
    const questLog = new Map<string, QuestProgress>();
    const questsDone = new Set<string>(['q_prof_workorder_forge']);

    // No mirror at all (offline shape, or an empty cprof snapshot).
    expect(
      optimisticQuestState('q_prof_workorder_forge', questLog, questsDone, noPending(), 5),
    ).toBe('available');
    // Membership must be per-quest, not mere presence of a cooldown set.
    expect(
      optimisticQuestState(
        'q_prof_workorder_forge',
        questLog,
        questsDone,
        noPending(),
        5,
        undefined,
        new Set(['q_prof_workorder_loom']),
      ),
    ).toBe('available');
  });

  it('lets a mirrored cadence block win over a pending accept for the same quest', () => {
    // A stale accept click racing the cooldown mirror must not conjure an
    // optimistic 'active': the accept promotion only applies to an 'available'
    // base state, and cadence resolves the base state to 'unavailable'.
    const questLog = new Map<string, QuestProgress>();
    const questsDone = new Set<string>(['q_prof_workorder_forge']);
    const pendingQuestCommands = new Map<string, 'accept' | 'turnin'>([
      ['q_prof_workorder_forge', 'accept'],
    ]);

    expect(
      optimisticQuestState(
        'q_prof_workorder_forge',
        questLog,
        questsDone,
        pendingQuestCommands,
        5,
        undefined,
        new Set(['q_prof_workorder_forge']),
      ),
    ).toBe('unavailable');
  });

  it('gates a second attunePair quest while another attunement is active in the mirrored log', () => {
    // One pending identity transition at a time: an active
    // smith attunement makes the outfitter offer unavailable even though the
    // unattuned profession state would otherwise make it a legal target.
    const questLog = new Map<string, QuestProgress>([
      ['q_prof_attune_smith', { questId: 'q_prof_attune_smith', counts: [0], state: 'active' }],
    ]);
    const questsDone = new Set<string>();

    expect(
      optimisticQuestState(
        'q_prof_attune_outfitter',
        questLog,
        questsDone,
        noPending(),
        5,
        emptyArchetypeState(),
      ),
    ).toBe('unavailable');
    // Positive control: with no attunement in flight the same state offers it.
    expect(
      optimisticQuestState(
        'q_prof_attune_outfitter',
        new Map<string, QuestProgress>(),
        questsDone,
        noPending(),
        5,
        emptyArchetypeState(),
      ),
    ).toBe('available');
  });

  it('shows a ready work order with a pending turn-in as active until the cadence mirrors', () => {
    // The reconciliation window: the turn-in command is in flight, so the quest
    // is still in the mirrored questLog as 'ready' and the server-armed cadence
    // has not reached cprof yet. The questLog entry resolves first ('ready'),
    // which the pending 'turnin' promotes to 'active': display-only optimism
    // that holds exactly until the snapshot drops the log entry, clears the
    // pending command, and delivers the cooldown set.
    const questLog = new Map<string, QuestProgress>([
      [
        'q_prof_workorder_forge',
        { questId: 'q_prof_workorder_forge', counts: [8], state: 'ready' },
      ],
    ]);
    const questsDone = new Set<string>();
    const pendingQuestCommands = new Map<string, 'accept' | 'turnin'>([
      ['q_prof_workorder_forge', 'turnin'],
    ]);

    expect(
      optimisticQuestState('q_prof_workorder_forge', questLog, questsDone, pendingQuestCommands, 5),
    ).toBe('active');
    // Post-snapshot resolution of the same window: log entry gone, pending
    // cleared, cadence mirrored, so the quest settles to 'unavailable'.
    expect(
      optimisticQuestState(
        'q_prof_workorder_forge',
        new Map<string, QuestProgress>(),
        new Set<string>(['q_prof_workorder_forge']),
        noPending(),
        5,
        undefined,
        new Set(['q_prof_workorder_forge']),
      ),
    ).toBe('unavailable');
  });
});
