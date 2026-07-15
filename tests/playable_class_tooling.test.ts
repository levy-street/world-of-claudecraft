import { describe, expect, it } from 'vitest';
import { LOAD_ATTACK_ABILITIES, PLAYABLE_CLASSES } from '../scripts/lib/playable_classes.mjs';
import { ALL_CLASSES } from '../src/sim/types';

describe('standalone tooling class inventory', () => {
  it('tracks every playable simulation class in canonical order', () => {
    expect(PLAYABLE_CLASSES).toEqual(ALL_CLASSES);
  });

  it('gives every load-test class an available baseline attack', () => {
    expect(Object.keys(LOAD_ATTACK_ABILITIES)).toEqual(ALL_CLASSES);
    expect(LOAD_ATTACK_ABILITIES.swordmaster).toBe('twin_slash');
  });
});
