import { describe, expect, it } from 'vitest';
import { duelEndVisibleToViewer, duelZoneIdAt } from '../src/sim/social/duel_zone';
import type { SimEvent } from '../src/sim/types';

const victory: Extract<SimEvent, { type: 'duelEnd' }> = {
  type: 'duelEnd',
  winnerName: 'Winner',
  loserName: 'Loser',
  winnerPid: 1,
  loserPid: 2,
  zoneId: 'eastbrook_vale',
};

describe('duel victory zone visibility', () => {
  it('includes distant zone residents and duelists who cross the border', () => {
    expect(duelEndVisibleToViewer(victory, 3, { x: 0, y: 0, z: -175 })).toBe(true);
    expect(duelEndVisibleToViewer(victory, 4, { x: 0, y: 0, z: 185 })).toBe(false);
    expect(duelEndVisibleToViewer(victory, 2, { x: 0, y: 0, z: 185 })).toBe(true);
  });

  it('keeps an instanced duel personal to its participants', () => {
    const instanceVictory = { ...victory, zoneId: duelZoneIdAt({ x: 100_900, y: 0, z: 0 }) };
    expect(instanceVictory.zoneId).toBeNull();
    expect(duelEndVisibleToViewer(instanceVictory, 1, { x: 100_900, y: 0, z: 0 })).toBe(true);
    expect(duelEndVisibleToViewer(instanceVictory, 3, { x: 100_900, y: 0, z: 0 })).toBe(false);
    expect(duelEndVisibleToViewer(victory, 3, { x: 100_900, y: 0, z: 0 })).toBe(false);
  });
});
