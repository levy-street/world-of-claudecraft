import { describe, expect, it } from 'vitest';
import {
  activeVarkhulAnvilMeteorWarnings,
  VARKHUL_ANVIL_METEOR_COUNT,
  VARKHUL_ANVIL_METEOR_DAMAGE_MAX_HP,
  VARKHUL_ANVIL_METEOR_RADIUS,
  VARKHUL_ANVIL_METEOR_WARNING_SECONDS,
  varkhulAnvilMeteorPattern,
} from '../src/sim/varkhul_anvil_meteors';

describe('Varkhul Heroic Anvil meteors', () => {
  it('pins three readable meteors after each hammer strike', () => {
    expect(VARKHUL_ANVIL_METEOR_COUNT).toBe(3);
    expect(VARKHUL_ANVIL_METEOR_WARNING_SECONDS).toBe(1.8);
    expect(VARKHUL_ANVIL_METEOR_RADIUS).toBe(3.5);
    expect(VARKHUL_ANVIL_METEOR_DAMAGE_MAX_HP).toBe(0.75);
  });

  it('builds a deterministic separated pattern inside the room', () => {
    const origin = { x: 100, z: 200 };
    const first = varkhulAnvilMeteorPattern(19, 1, origin);
    expect(first).toEqual(varkhulAnvilMeteorPattern(19, 1, origin));
    expect(first).toHaveLength(3);
    for (const point of first) {
      expect(Math.hypot(point.x - origin.x, point.z - origin.z)).toBeLessThanOrEqual(25);
    }
    for (let a = 0; a < first.length; a++) {
      for (let b = a + 1; b < first.length; b++) {
        expect(Math.hypot(first[a].x - first[b].x, first[a].z - first[b].z)).toBeGreaterThan(7);
      }
    }
  });

  it('projects the warning countdown with stable persistent ids', () => {
    const state = {
      castKey: 4,
      strikeIndex: 2,
      remaining: 1.2,
      points: [
        { x: 3, z: 4 },
        { x: 8, z: 9 },
        { x: 13, z: 14 },
      ],
    };
    expect(activeVarkhulAnvilMeteorWarnings(77, state)).toEqual([
      {
        id: 'varkhul-anvil:77:4:2:0',
        x: 3,
        z: 4,
        radius: 3.5,
        duration: 1.8,
        remaining: 1.2,
        warningLead: 0,
      },
      {
        id: 'varkhul-anvil:77:4:2:1',
        x: 8,
        z: 9,
        radius: 3.5,
        duration: 1.8,
        remaining: 1.2,
        warningLead: 0,
      },
      {
        id: 'varkhul-anvil:77:4:2:2',
        x: 13,
        z: 14,
        radius: 3.5,
        duration: 1.8,
        remaining: 1.2,
        warningLead: 0,
      },
    ]);
  });
});
