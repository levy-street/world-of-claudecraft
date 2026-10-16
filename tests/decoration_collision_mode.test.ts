// The procedural decoration field must be gated by `decorationsMode` on BOTH
// of its readers, or the world collides with scatter it does not draw.
//
// The renderer reads it through generateDecorations(); collision (colliders.ts
// -> collidersInCell) reads it through generateDecorationsInBounds(). When only
// the first honoured the 'empty' mode, every blank/flat custom map and every map
// whose maker ran "make all foliage editable" kept a collision circle at each
// tree trunk and rock anchor with nothing rendered there: invisible walls.
import { afterEach, describe, expect, it } from 'vitest';
import { invalidateStaticColliders, isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { generateDecorations, generateDecorationsInBounds } from '../src/sim/world';

const SEED = 20061;

function useContent(decorationsMode: 'empty' | undefined): void {
  setActiveWorldContent({ ...BUILTIN_WORLD, decorationsMode });
  invalidateStaticColliders();
}

/** A decoration anchor that actually produces a collider, so the assertions
 *  below are about the gate and not about an empty patch of world. */
function findBlockingDecoration(): { x: number; z: number } {
  const field = generateDecorationsInBounds(SEED, {
    minX: -160,
    maxX: 160,
    minZ: -160,
    maxZ: 160,
  });
  const hit = field.find(
    (d) => (d.kind === 'rock' ? d.scale >= 0.8 : true) && isBlocked(SEED, d.x, d.z, 0.5),
  );
  if (!hit) throw new Error('no blocking decoration found in the sample region');
  return { x: hit.x, z: hit.z };
}

describe('decorationsMode gates decoration COLLISION, not just rendering', () => {
  afterEach(() => {
    setActiveWorldContent(null);
    invalidateStaticColliders();
  });

  it('keeps the field, and its collision, on an ordinary map', () => {
    useContent(undefined);
    const at = findBlockingDecoration();
    expect(generateDecorations(SEED).length).toBeGreaterThan(0);
    expect(isBlocked(SEED, at.x, at.z, 0.5)).toBe(true);
  });

  it('drops the collision wherever it drops the render', () => {
    useContent(undefined);
    const at = findBlockingDecoration();
    expect(isBlocked(SEED, at.x, at.z, 0.5)).toBe(true);

    useContent('empty');
    // The renderer draws nothing...
    expect(generateDecorations(SEED)).toEqual([]);
    // ...so nothing may block there either.
    expect(
      generateDecorationsInBounds(SEED, { minX: -160, maxX: 160, minZ: -160, maxZ: 160 }),
    ).toEqual([]);
    expect(isBlocked(SEED, at.x, at.z, 0.5)).toBe(false);
  });

  it('agrees with generateDecorations about emptiness in both modes', () => {
    for (const mode of [undefined, 'empty' as const]) {
      useContent(mode);
      const whole = generateDecorations(SEED).length > 0;
      const bounded =
        generateDecorationsInBounds(SEED, { minX: -540, maxX: 540, minZ: -180, maxZ: 2420 })
          .length > 0;
      expect(bounded, `mode=${mode}`).toBe(whole);
    }
  });
});
