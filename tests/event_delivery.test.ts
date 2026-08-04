import { describe, expect, it } from 'vitest';
import { shouldDeliverCombatEventToViewer } from '../server/event_delivery';
import type { SimEvent } from '../src/sim/types';

const damage = (sourceId: number, targetId: number, sourceOwnerId?: number): SimEvent =>
  ({
    type: 'damage',
    sourceId,
    targetId,
    sourceOwnerId,
    amount: 12,
    crit: false,
    school: 'fire',
    ability: 'Ashbolt',
    kind: 'hit',
  }) as SimEvent;

describe('combat event delivery', () => {
  it('delivers controlled pet damage to the owning player', () => {
    expect(shouldDeliverCombatEventToViewer(damage(30, 50, 1), 1, null)).toBe(true);
  });

  it('delivers controlled pet damage to the owner party', () => {
    expect(shouldDeliverCombatEventToViewer(damage(30, 50, 2), 1, { members: [2] })).toBe(true);
  });

  it('keeps unrelated pet damage out of the viewer stream', () => {
    expect(shouldDeliverCombatEventToViewer(damage(30, 50, 9), 1, { members: [2] })).toBe(false);
  });
});
