import { describe, expect, it } from 'vitest';
import { optimisticQuestState } from '../src/net/quest_state_optimistic';
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
