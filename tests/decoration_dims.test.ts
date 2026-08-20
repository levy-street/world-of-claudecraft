import { describe, expect, it } from 'vitest';
import { queryOpenWorldColliders } from '../src/sim/colliders';
import { decorationHasCollider, ROCK_COLLIDER_MIN_SCALE } from '../src/sim/decoration_dims';
import type { Decoration } from '../src/sim/world';
import { generateDecorations } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const deco = (over: Partial<Decoration>): Decoration => ({
  kind: 'rock',
  x: 0,
  z: 0,
  scale: 1,
  variant: 0,
  biome: 'vale',
  ...over,
});

describe('decorationHasCollider', () => {
  it('is true for a rock at or above the collider-min scale', () => {
    expect(decorationHasCollider(deco({ kind: 'rock', scale: ROCK_COLLIDER_MIN_SCALE }))).toBe(
      true,
    );
    expect(decorationHasCollider(deco({ kind: 'rock', scale: 1.6 }))).toBe(true);
  });

  it('is false for a rock below the collider-min scale (pure dressing, colliders.ts skips it)', () => {
    expect(
      decorationHasCollider(deco({ kind: 'rock', scale: ROCK_COLLIDER_MIN_SCALE - 0.01 })),
    ).toBe(false);
    expect(decorationHasCollider(deco({ kind: 'rock', scale: 0.7 }))).toBe(false);
  });

  it('is always true for tree/tree2: colliders.ts gives every trunk a collider unconditionally', () => {
    expect(decorationHasCollider(deco({ kind: 'tree', scale: 0.1 }))).toBe(true);
    expect(decorationHasCollider(deco({ kind: 'tree2', scale: 1.6 }))).toBe(true);
  });

  // Oracle test: the two cases above pin decorationHasCollider against a
  // restatement of its own rule. This pins it against what colliders.ts
  // ACTUALLY builds for a real sample of the live world, so a future gate
  // added to decorationCollider() (a region skip, a slope check, ...) that
  // decorationHasCollider does not learn about fails here immediately,
  // instead of quietly reopening the invisible-but-solid bug this predicate
  // exists to prevent (survivesLeanDecimation trusts this answer to keep a
  // collidable rock visible on every graphics tier).
  it('agrees with queryOpenWorldColliders for a real sample of the live world', () => {
    const decos = generateDecorations(WORLD_SEED).filter(
      (d) => Math.abs(d.x) < 160 && d.z > -160 && d.z < 500, // stay off the world rim
    );
    const sample = decos.filter((_, i) => i % 7 === 0);
    let rockChecked = 0;
    let treeChecked = 0;
    for (const d of sample) {
      const near: ReturnType<typeof queryOpenWorldColliders> = [];
      queryOpenWorldColliders(WORLD_SEED, d.x - 0.15, d.z - 0.15, d.x + 0.15, d.z + 0.15, near);
      const hasBodyHere = near.some((c) => Math.hypot((c.x ?? 0) - d.x, (c.z ?? 0) - d.z) < 0.1);
      expect(hasBodyHere, `${d.kind} scale ${d.scale} at (${d.x}, ${d.z})`).toBe(
        decorationHasCollider(d),
      );
      if (d.kind === 'rock') rockChecked++;
      else treeChecked++;
    }
    // Vacuity floor: a biome-skewed sample could pass without ever exercising
    // one of the two arms this predicate distinguishes.
    expect(rockChecked).toBeGreaterThan(5);
    expect(treeChecked).toBeGreaterThan(5);
  });
});
