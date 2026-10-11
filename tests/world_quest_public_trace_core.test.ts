import { describe, expect, it } from 'vitest';
import {
  newPublicTraceSlots,
  type PublicTraceReader,
  publicTraceSlotsInto,
} from '../src/render/world_quest_public_trace_core';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { NearbyWorldQuestTrace } from '../src/sim/world_quest_trace_public';
import {
  WORLD_QUEST_TRACE_VARIANTS,
  worldQuestTraceShape,
} from '../src/sim/world_quest_trace_variants';

const questId = 'wq_eastbrook_calligraphy';
function row(pid = 2, variant = 'star'): NearbyWorldQuestTrace {
  return {
    pid,
    name: `Writer${pid}`,
    questId,
    shapeIndex: 2,
    variant,
    phase: 'drawing',
    trail: [
      { x: 166, z: -31 },
      { x: 167, z: -31 },
    ],
  };
}
function world(traces: NearbyWorldQuestTrace[]): PublicTraceReader {
  return {
    nearbyWorldQuestTraces: traces,
    player: { id: 1, pos: { x: 172, y: 0, z: -28 } },
    entities: new Map(
      [1, 2, 3, 4, 5, 6].map((id) => [
        id,
        {
          id,
          kind: 'player' as const,
          name: `Writer${id}`,
          hostile: false,
          dead: false,
          pos: { x: 172, y: 0, z: -28 },
        },
      ]),
    ),
  };
}

describe('public calligraphy plans', () => {
  it('keeps four owner slots stable through reordering and reuses the freed slot', () => {
    const slots = newPublicTraceSlots();
    const identities = [...slots];
    const w = world([row(2), row(3), row(4), row(5), row(6)]);
    publicTraceSlotsInto(slots, w, WORLD_QUESTS_BY_ID);
    expect(slots.map((s) => s.trace?.pid)).toEqual([2, 3, 4, 5]);
    w.nearbyWorldQuestTraces = [row(5), row(4), row(3), row(2)];
    publicTraceSlotsInto(slots, w, WORLD_QUESTS_BY_ID);
    expect(slots.map((s) => s.trace?.pid)).toEqual([2, 3, 4, 5]);
    w.nearbyWorldQuestTraces = [row(5), row(4), row(3), row(6)];
    publicTraceSlotsInto(slots, w, WORLD_QUESTS_BY_ID);
    expect(slots.map((s) => s.trace?.pid)).toEqual([6, 3, 4, 5]);
    expect(slots.every((slot, index) => slot === identities[index])).toBe(true);
    w.nearbyWorldQuestTraces = [];
    publicTraceSlotsInto(slots, w, WORLD_QUESTS_BY_ID);
    expect(slots.every((s) => !s.trace && !s.shape && !s.name)).toBe(true);
  });
  it.each(WORLD_QUEST_TRACE_VARIANTS)(
    'uses the authoritative %s shape and exposes no guide plan',
    (variant) => {
      const slots = newPublicTraceSlots();
      const trace = row(2, variant);
      publicTraceSlotsInto(slots, world([trace]), WORLD_QUESTS_BY_ID);
      expect(slots[0].shape).toBe(worldQuestTraceShape(WORLD_QUESTS_BY_ID[questId], 2, variant));
      expect(slots[0].shape?.kind).toBe(variant);
      expect(Object.keys(slots[0]).sort()).toEqual(['name', 'shape', 'trace', 'x', 'z']);
    },
  );
  it('hides self, hostile, unknown, invalid and name-mismatched records', () => {
    const malformed: NearbyWorldQuestTrace[] = [
      row(1),
      { ...row(), name: 'NotTheEntity' },
      { ...row(), variant: 'unknown' },
      { ...row(), shapeIndex: 99 },
      { ...row(), phase: 'preview' } as unknown as NearbyWorldQuestTrace,
      { ...row(), trail: [{ x: Number.NaN, z: 0 }] },
      { ...row(), trail: Array.from({ length: 33 }, () => ({ x: 166, z: -31 })) },
    ];
    for (const trace of malformed) {
      const slots = newPublicTraceSlots();
      publicTraceSlotsInto(slots, world([trace]), WORLD_QUESTS_BY_ID);
      expect(slots.every((s) => !s.trace)).toBe(true);
    }
    const w = world([row()]);
    const entity = w.entities.get(2);
    if (!entity) throw new Error('fixture');
    entity.hostile = true;
    const slots = newPublicTraceSlots();
    publicTraceSlotsInto(slots, w, WORLD_QUESTS_BY_ID);
    expect(slots.every((s) => !s.trace)).toBe(true);
  });
  it('does not duplicate one owner, and rejects expired-looking or invalid success payloads', () => {
    const slots = newPublicTraceSlots();
    const trace = row();
    publicTraceSlotsInto(slots, world([trace, trace]), WORLD_QUESTS_BY_ID);
    expect(slots.filter((s) => s.trace)).toHaveLength(1);
    for (const extra of [
      { score: 101, rating: 'gold', expiresAt: 5 },
      { score: 99, rating: 'platinum', expiresAt: 5 },
      { score: 99, rating: 'gold', expiresAt: 0 },
    ]) {
      publicTraceSlotsInto(
        slots,
        world([{ ...trace, phase: 'success', ...extra } as NearbyWorldQuestTrace]),
        WORLD_QUESTS_BY_ID,
      );
      expect(slots.every((s) => !s.trace)).toBe(true);
    }
  });
});
