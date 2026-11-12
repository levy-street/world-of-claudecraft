import { describe, expect, it } from 'vitest';
import { baselinePushbackImmune } from '../src/sim/combat/pushback_baseline';
import { ABILITIES } from '../src/sim/data';

describe('baselinePushbackImmune', () => {
  it('covers Ghost Wolf and every ability authored uninterruptible, nothing else', () => {
    expect(baselinePushbackImmune(ABILITIES.ghost_wolf)).toBe(true);
    expect(baselinePushbackImmune(ABILITIES.bladestorm)).toBe(true);
    expect(baselinePushbackImmune(ABILITIES.fireball)).toBe(false);
    for (const def of Object.values(ABILITIES)) {
      expect(baselinePushbackImmune(def), def.id).toBe(
        def.id === 'ghost_wolf' || def.uninterruptible === true,
      );
    }
  });
});
