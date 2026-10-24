import { describe, expect, it } from 'vitest';
import { drawIdleVariant, onIdleLoopSeam } from '../src/render/characters/anim_state';
import { VISUALS } from '../src/render/characters/manifest';

const FIDGETS = ['Nuzzle', 'Peekaboo', 'Dance', 'Doze', 'Leapfrog'];

/** A seeded generator, so each case is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function draws(count: number, seed: number, variants = FIDGETS): string[] {
  const bag: string[] = [];
  const random = seeded(seed);
  let last: string | null = null;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    last = drawIdleVariant(variants, bag, last, random);
    out.push(last);
  }
  return out;
}

describe('shuffled idle variants (ClipMap.idleVariantsShuffled)', () => {
  it('plays every fidget once per round before any repeats', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const seq = draws(FIDGETS.length * 6, seed);
      for (let round = 0; round < 6; round++) {
        const slice = seq.slice(round * FIDGETS.length, (round + 1) * FIDGETS.length);
        expect([...slice].sort(), `seed ${seed} round ${round}`).toEqual([...FIDGETS].sort());
      }
    }
  });

  it('never plays the same fidget twice in a row, across rounds too', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const seq = draws(60, seed);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i], `seed ${seed} draw ${i}`).not.toBe(seq[i - 1]);
      }
    }
  });

  it('still varies the order between rounds', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) orders.add(draws(FIDGETS.length, seed).join(','));
    expect(orders.size).toBeGreaterThan(10);
  });

  it('copes with a pool of one', () => {
    expect(draws(3, 7, ['Only'])).toEqual(['Only', 'Only', 'Only']);
  });

  it('is what the sprite buddy uses: its Idle in the bag, every draw on the Idle seam', () => {
    const clips = VISUALS.buddy_sprites.clips;
    expect(clips.idleVariantsShuffled).toBe(true);
    expect(clips.idleVariantsOnLoopSeam).toBe(true);
    expect(clips.idleVariants).toHaveLength(5);
    expect(clips.idleVariantsIncludeIdle).toBe(true);
    expect(clips.idleVariantCadence).toEqual({ everySec: 1, jitterSec: 0 });
  });

  it('opens the seam window either side of the loop wrap only', () => {
    expect(onIdleLoopSeam(0.05, 6)).toBe(true);
    expect(onIdleLoopSeam(5.95, 6)).toBe(true);
    expect(onIdleLoopSeam(12.05, 6)).toBe(true);
    expect(onIdleLoopSeam(3, 6)).toBe(false);
  });
});
