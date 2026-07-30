import { describe, expect, it } from 'vitest';
import { shouldShowSlowConnectionHint } from '../src/ui/loading_slow_hint_core';

describe('shouldShowSlowConnectionHint', () => {
  it('stays false while progress is still moving at a normal pace', () => {
    expect(shouldShowSlowConnectionHint(0, 6_000)).toBe(false);
    expect(shouldShowSlowConnectionHint(5_999, 6_000)).toBe(false);
  });

  it('flips true once progress has been quiet for the full threshold', () => {
    expect(shouldShowSlowConnectionHint(6_000, 6_000)).toBe(true);
    expect(shouldShowSlowConnectionHint(20_000, 6_000)).toBe(true);
  });

  it('defaults to the exported threshold when none is passed', () => {
    expect(shouldShowSlowConnectionHint(5_999)).toBe(false);
    expect(shouldShowSlowConnectionHint(6_000)).toBe(true);
  });
});
