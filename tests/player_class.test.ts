import { describe, expect, it } from 'vitest';
import { canonicalPlayerClassName, isPlayerClass, PLAYER_CLASSES } from '../server/player_class';
import { CLASSES } from '../src/sim/content/classes';
import { ALL_CLASSES } from '../src/sim/types';

describe('server player-class registry', () => {
  it('mirrors the canonical sim registry and accepts SwordMaster on every server surface', () => {
    expect(PLAYER_CLASSES).toEqual(ALL_CLASSES);
    expect(PLAYER_CLASSES).toHaveLength(10);
    expect(Object.isFrozen(PLAYER_CLASSES)).toBe(true);
    expect(new Set(PLAYER_CLASSES).size).toBe(PLAYER_CLASSES.length);
    expect(isPlayerClass('swordmaster')).toBe(true);
    for (const playerClass of PLAYER_CLASSES) {
      expect(canonicalPlayerClassName(playerClass)).toBe(CLASSES[playerClass].name);
    }
  });

  it('rejects unregistered, malformed, and differently cased values', () => {
    for (const value of ['SwordMaster', ' swordmaster', 'swordmaster ', 'jester', '', null, 10]) {
      expect(isPlayerClass(value)).toBe(false);
      expect(canonicalPlayerClassName(value)).toBe('');
    }
  });
});
