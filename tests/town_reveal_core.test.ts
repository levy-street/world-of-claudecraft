import { describe, expect, it } from 'vitest';
import { townStaticReveal } from '../src/render/town_reveal_core';

const CULL_RADIUS = 60;

describe('town static first-reveal policy (hitch-hunt P3a)', () => {
  it('fog-hidden wins regardless of the latch, without consulting the gate', () => {
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return true;
      },
    };
    expect(townStaticReveal(false, false, 1e6, CULL_RADIUS, gate, 'town')).toBe('hidden');
    expect(townStaticReveal(false, true, 1e6, CULL_RADIUS, gate, 'town')).toBe('hidden');
    expect(consulted).toBe(0);
  });

  it('an already-revealed town never consults the gate again', () => {
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return false;
      },
    };
    expect(townStaticReveal(true, true, 1e6, CULL_RADIUS, gate, 'town')).toBe('revealed');
    expect(consulted).toBe(0);
  });

  it('a camera already inside the town reveals immediately, gate unconsulted', () => {
    // Login, hearth, or teleport lands the player among the buildings: a hold
    // would leave the sim colliders blocking movement against invisible
    // walls, so the inside case must never wait.
    let consulted = 0;
    const gate = {
      allow: () => {
        consulted++;
        return false;
      },
    };
    const inside = CULL_RADIUS * CULL_RADIUS;
    expect(townStaticReveal(true, false, inside, CULL_RADIUS, gate, 'town')).toBe('revealed');
    expect(consulted).toBe(0);
  });

  it('a walking approach holds while the gate denies and reveals once it allows', () => {
    const outside = (CULL_RADIUS + 1) * (CULL_RADIUS + 1);
    let warm = false;
    const consulted: string[] = [];
    const gate = {
      allow: (key: string) => {
        consulted.push(key);
        return warm;
      },
    };
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, gate, 'town')).toBe('held');
    warm = true;
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, gate, 'town')).toBe('revealed');
    expect(consulted).toEqual(['town', 'town']);
  });

  it('no gate keeps the historical immediate reveal', () => {
    const outside = (CULL_RADIUS + 1) * (CULL_RADIUS + 1);
    expect(townStaticReveal(true, false, outside, CULL_RADIUS, null, 'town')).toBe('revealed');
  });
});
