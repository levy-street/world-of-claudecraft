import { describe, expect, it } from 'vitest';
import { talentTreeFitScale } from '../src/ui/talent_tree_fit';

describe('talentTreeFitScale', () => {
  it('does not scale up when the tree already fits', () => {
    expect(talentTreeFitScale(300, 300, 800, 600)).toBe(1);
  });

  it('shrinks to the tighter of width/height so the whole tree fits', () => {
    expect(talentTreeFitScale(600, 300, 300, 300)).toBeCloseTo(0.5);
    expect(talentTreeFitScale(300, 600, 300, 300)).toBeCloseTo(0.5);
  });

  it('floors the scale so nodes stay tappable instead of vanishing to a point', () => {
    expect(talentTreeFitScale(2000, 2000, 100, 100)).toBeCloseTo(0.42);
  });

  it('falls back to 1 on a degenerate (zero/negative) input', () => {
    expect(talentTreeFitScale(0, 300, 400, 300)).toBe(1);
    expect(talentTreeFitScale(300, 300, 0, 300)).toBe(1);
    expect(talentTreeFitScale(300, 300, 400, -1)).toBe(1);
  });
});
