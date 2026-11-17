import { describe, expect, it } from 'vitest';
import {
  buildRealmFlora,
  buildRealmFloraSteps,
  placeFlora,
  placeFloraSteps,
} from '../src/render/realm_flora';
import { drainBuild } from '../src/render/stepped_build_core';

/** Drain a stepped build, counting its pieces. */
function stepped<T>(build: Generator<void, T, void>): { value: T; pieces: number } {
  let pieces = 0;
  for (;;) {
    const next = build.next();
    if (next.done) return { value: next.value, pieces };
    pieces++;
  }
}

function shape(object: { name: string; type: string; children: unknown[] }): unknown {
  return {
    name: object.name,
    type: object.type,
    children: (object.children as { name: string; type: string; children: unknown[] }[]).map(shape),
  };
}

describe('realm flora as a stepped build', () => {
  // placeFlora drains placeFloraSteps, so equality here only guards the
  // wrapper; what this pins is the granularity (many small pieces). The dead
  // grid loop's removal was checked byte-identical across four seeds when it
  // went, and nothing between yields reads the clock.
  it('places flora in many small pieces, and the wrapper returns the drained result', () => {
    for (const seed of [1, 1337]) {
      const { value, pieces } = stepped(placeFloraSteps(seed));
      expect(value).toEqual(placeFlora(seed));
      // One piece per placement grid column (boulders and the coast), so no
      // single piece is more than a sliver of the pass.
      expect(pieces).toBeGreaterThanOrEqual(100);
    }
  });

  it('builds the same view stepped as in one call', () => {
    const whole = buildRealmFlora(7);
    const { value, pieces } = stepped(buildRealmFloraSteps(7));
    expect(pieces).toBeGreaterThan(100);
    expect(shape(value.group)).toEqual(shape(whole.group));
    expect(value.glowLights.length).toBe(whole.glowLights.length);
    expect(value.animated.length).toBe(whole.animated.length);
    expect(drainBuild(buildRealmFloraSteps(7)).group.name).toBe('realm-flora');
  });
});
