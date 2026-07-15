import { describe, expect, it } from 'vitest';
import { isPlayerClass, PLAYER_CLASSES } from '../server/player_class';
import { ALL_CLASSES } from '../src/sim/types';

describe('server player-class registry', () => {
  it('mirrors the canonical sim registry and accepts SwordMaster on every server surface', () => {
    expect(PLAYER_CLASSES).toEqual(ALL_CLASSES);
    expect(PLAYER_CLASSES).toHaveLength(10);
    expect(Object.isFrozen(PLAYER_CLASSES)).toBe(true);
    expect(new Set(PLAYER_CLASSES).size).toBe(PLAYER_CLASSES.length);
    expect(isPlayerClass('swordmaster')).toBe(true);
  });

  it('rejects unregistered, malformed, and differently cased values', () => {
    for (const value of ['SwordMaster', ' swordmaster', 'swordmaster ', 'jester', '', null, 10]) {
      expect(isPlayerClass(value)).toBe(false);
    }
  });
});
