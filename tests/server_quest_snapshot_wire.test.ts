import { describe, expect, it, vi } from 'vitest';
import { emitQuestSelfKeys } from '../server/quest_snapshot_wire';
import type { PlayerMeta, Sim } from '../src/sim/sim';

describe('quest snapshot wire', () => {
  it('emits the ordinary and rotating quest owner fields together', () => {
    const emit = vi.fn();
    const quest = { questId: 'q_test' };
    const worldQuest = { questId: 'wq_test' };
    const meta = {
      questLog: new Map([['q_test', quest]]),
      questsDone: new Set(['q_done']),
      worldQuestCycle: '2030-01-02',
      worldQuestLog: new Map([['wq_test', worldQuest]]),
    } as unknown as PlayerMeta;
    const sim = { worldQuestExpiresAtMs: 1_893_542_400_000 } as Sim;

    emitQuestSelfKeys(emit, sim, meta);

    expect(emit.mock.calls).toEqual([
      ['qlog', [quest]],
      ['qdone', ['q_done']],
      ['wqday', '2030-01-02'],
      ['wqexp', 1_893_542_400_000],
      ['wqlog', [worldQuest]],
    ]);
  });
});
