import { describe, expect, it } from 'vitest';
import { talentBodyMaxHeight } from '../src/ui/talent_body_fit';

describe('talentBodyMaxHeight', () => {
  it('reproduces the reported bug: a tall Specialization tab overflows the window budget, leaving less than the full foot height', () => {
    // Measured live from the repro: window max-height 740.15, #tal-body top
    // offset 129.65 within the window, foot's natural height 187.3, and
    // #tal-body's own natural content (specs + mastery + tree) came to about
    // 480px, well over what remains (740.15 - 129.65 - 187.3 = 423.2).
    const cap = talentBodyMaxHeight(740.15, 129.65, 187.3);
    expect(cap).not.toBeNull();
    expect(cap).toBeCloseTo(419.2, 1);
    expect(cap).toBeLessThan(480); // the natural body height that triggered the bug
  });

  it('returns null when the window has no usable budget left for the body', () => {
    expect(talentBodyMaxHeight(300, 150, 187)).toBeNull(); // 300-150-187-4 < 0
  });

  it('returns null for non-finite / negative inputs instead of a nonsense cap', () => {
    expect(talentBodyMaxHeight(0, 0, 0)).toBeNull();
    expect(talentBodyMaxHeight(500, -10, 100)).toBeNull();
    expect(talentBodyMaxHeight(500, 100, -10)).toBeNull();
  });

  it('leaves headroom for the buffer, never exactly zero-cap when just barely fitting', () => {
    const cap = talentBodyMaxHeight(500, 100, 396); // 500-100-396 = 4, minus buffer 4 = 0
    expect(cap).toBeNull();
  });
});
