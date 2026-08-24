import { describe, expect, it } from 'vitest';
import { survivesLeanDecimation } from '../src/render/foliage_decimation_core';
import { decorationHasCollider, ROCK_COLLIDER_MIN_SCALE } from '../src/sim/decoration_dims';
import type { Decoration } from '../src/sim/world';

const deco = (over: Partial<Decoration>): Decoration => ({
  kind: 'rock',
  x: 0,
  z: 0,
  scale: 1,
  variant: 0,
  biome: 'vale',
  ...over,
});

describe('survivesLeanDecimation', () => {
  it('never drops a rock big enough to carry a collider, no matter the hash draw', () => {
    const solidRock = deco({ kind: 'rock', scale: ROCK_COLLIDER_MIN_SCALE });
    // 0.999999 is as unlucky a draw as the caller's hash can produce; every
    // keep-rate below is < 1, so a pre-fix implementation drops this rock.
    expect(survivesLeanDecimation(solidRock, 0.999999, true)).toBe(true);
    expect(survivesLeanDecimation(solidRock, 0.999999, false)).toBe(true);
    expect(survivesLeanDecimation(deco({ kind: 'rock', scale: 1.6 }), 0.999999, false)).toBe(true);
  });

  it('still decimates dressing rocks below the collider floor, at the tuned keep rates', () => {
    const dressing = deco({ kind: 'rock', scale: ROCK_COLLIDER_MIN_SCALE - 0.01 });
    expect(survivesLeanDecimation(dressing, 0.5, true)).toBe(true); // 0.5 < 0.74 keep
    expect(survivesLeanDecimation(dressing, 0.8, true)).toBe(false); // 0.8 >= 0.74 keep
    expect(survivesLeanDecimation(dressing, 0.5, false)).toBe(true); // 0.5 < 0.55 keep
    expect(survivesLeanDecimation(dressing, 0.6, false)).toBe(false); // 0.6 >= 0.55 keep
  });

  it('never drops a tree/tree2, no matter the hash draw: every trunk carries an unconditional collider', () => {
    // 0.999999 is as unlucky a draw as the caller's hash can produce; the old
    // tuned keep rates (0.68 / 0.46) were both < 1, so a pre-fix
    // implementation drops these trees.
    const pine = deco({ kind: 'tree', scale: 0.7 });
    expect(survivesLeanDecimation(pine, 0.999999, true)).toBe(true);
    expect(survivesLeanDecimation(pine, 0.999999, false)).toBe(true);
    const oak = deco({ kind: 'tree2', scale: 1.6 });
    expect(survivesLeanDecimation(oak, 0.999999, true)).toBe(true);
    expect(survivesLeanDecimation(oak, 0.999999, false)).toBe(true);
  });

  // Pins the delegation itself, not just a few hand-picked cases: the
  // unconditional-keep branch must be EXACTLY decorationHasCollider, for
  // every kind/scale combination this design space has, on both material
  // tiers. 1 - EPSILON is as unlucky a hash draw as the caller's hash can
  // produce; every tuned keep rate is < 1, so this fails immediately if a
  // future "optimization" reintroduces a kind-specific carve-out that
  // diverges from decorationHasCollider (which is exactly the bug this
  // predicate exists to prevent from reopening).
  it('unconditionally keeps a decoration iff decorationHasCollider says so, for every kind x scale', () => {
    const kinds: Decoration['kind'][] = ['rock', 'tree', 'tree2'];
    const scales = [0, 0.3, ROCK_COLLIDER_MIN_SCALE - 0.01, ROCK_COLLIDER_MIN_SCALE, 1, 1.6, 3];
    for (const kind of kinds) {
      for (const scale of scales) {
        const d = deco({ kind, scale });
        const solid = decorationHasCollider(d);
        expect(survivesLeanDecimation(d, 1 - Number.EPSILON, true)).toBe(solid);
        expect(survivesLeanDecimation(d, 1 - Number.EPSILON, false)).toBe(solid);
      }
    }
  });
});

// If Decoration['kind'] ever grows a new member, this switch's default arm
// stops type-checking (its parameter is no longer `never`), which fails
// `npx tsc --noEmit` until this file (and decorationHasCollider's callers)
// are taught about it. A plain kind array, unlike a switch, can silently
// miss a new member forever.
function assertKnownDecorationKind(kind: Decoration['kind']): void {
  switch (kind) {
    case 'rock':
    case 'tree':
    case 'tree2':
      return;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled decoration kind: ${exhaustive}`);
    }
  }
}

describe('Decoration kind coverage', () => {
  it('covers every live Decoration kind (compile-time exhaustive; see assertKnownDecorationKind)', () => {
    for (const kind of ['rock', 'tree', 'tree2'] as const) assertKnownDecorationKind(kind);
  });
});
