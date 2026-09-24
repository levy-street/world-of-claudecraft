import { describe, expect, it, vi } from 'vitest';
import {
  collectPublicTraceCandidate,
  emitQuestSelfKeys,
  PUBLIC_WORLD_QUEST_TRACE_RADIUS,
  type PublicTraceCandidate,
} from '../server/quest_snapshot_wire';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

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
      factions: { rift_watch: 30, church_order: 0, automatons: 0 },
      factionCurrencies: { rift_watch: 10, church_order: 5, automatons: 0 },
      worldQuestRerollCycle: 'wq1_1',
      worldQuestReplacements: { wq_test: 'wq_other' },
      clueHunt: { huntId: 'hunt_test', step: 2 },
    } as unknown as PlayerMeta;
    const sim = { worldQuestExpiresAtMs: 1_893_542_400_000 } as Sim;

    emitQuestSelfKeys(emit, sim, meta);

    expect(emit.mock.calls).toEqual([
      ['qlog', [quest]],
      ['qdone', ['q_done']],
      ['wqday', '2030-01-02'],
      ['wqexp', 1_893_542_400_000],
      ['wqlog', [worldQuest]],
      ['fac', meta.factions],
      ['facCur', meta.factionCurrencies],
      ['cluh', { huntId: 'hunt_test', step: 2 }],
      ['wqrr', meta.worldQuestRerollCycle],
      ['wqrep', { wq_test: 'wq_other' }],
    ]);
  });
});

describe('public trace candidate collection', () => {
  const player = { id: 7 } as Entity;
  const edge = PUBLIC_WORLD_QUEST_TRACE_RADIUS * PUBLIC_WORLD_QUEST_TRACE_RADIUS;

  it('keeps an active tracer at or inside the public radius, with its squared distance', () => {
    const out: PublicTraceCandidate[] = [];
    collectPublicTraceCandidate(new Set([7]), player, 4, out);
    collectPublicTraceCandidate(new Set([7]), player, edge, out);
    expect(out).toEqual([
      { player, distance: 4 },
      { player, distance: edge },
    ]);
  });

  it('skips a player beyond the radius, a non-tracer, and every entity when nobody traces', () => {
    const out: PublicTraceCandidate[] = [];
    collectPublicTraceCandidate(new Set([7]), player, edge + 1, out);
    collectPublicTraceCandidate(new Set([8]), player, 4, out);
    collectPublicTraceCandidate(new Set(), player, 4, out);
    expect(out).toEqual([]);
  });
});
