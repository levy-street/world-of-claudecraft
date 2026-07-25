import { describe, expect, it } from 'vitest';
import { BOOL_SETTINGS } from '../src/game/settings';
import { shouldClearTargetOnGroundClick } from '../src/game/target_click';

describe('sticky target: ground-click clear decision', () => {
  it('clears on a left-click on empty ground by default (sticky off)', () => {
    expect(shouldClearTargetOnGroundClick(0, false)).toBe(true);
  });

  it('keeps the target on a ground left-click when sticky targeting is on', () => {
    expect(shouldClearTargetOnGroundClick(0, true)).toBe(false);
  });

  it('never clears on a non-left button, sticky or not', () => {
    expect(shouldClearTargetOnGroundClick(2, false)).toBe(false);
    expect(shouldClearTargetOnGroundClick(2, true)).toBe(false);
    expect(shouldClearTargetOnGroundClick(1, false)).toBe(false);
  });

  it('defaults to the current behavior: the stickyTarget setting ships off', () => {
    expect(BOOL_SETTINGS.stickyTarget.def).toBe(false);
  });
});
