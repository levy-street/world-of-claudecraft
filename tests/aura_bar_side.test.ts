// Behavioral pin for the buff-placement bug fix (replaces a source-text scan
// on main.ts, which has no lightweight instantiation seam of its own). A
// hand-rolled fake classList, the repo's convention for DOM-shaped units that
// don't need a full jsdom/happy-dom environment (see tests/movable_frame.test.ts).
import { describe, expect, it } from 'vitest';
import { AURA_BAR_BELOW_CLASS, applyAuraBarSide } from '../src/ui/aura_bar_side';

class FakeClassList {
  private set = new Set<string>();
  toggle(cls: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(cls);
    if (on) this.set.add(cls);
    else this.set.delete(cls);
    return on;
  }
  contains(cls: string): boolean {
    return this.set.has(cls);
  }
}

describe('applyAuraBarSide', () => {
  it('adds the below-placement class when the setting is on', () => {
    const body = { classList: new FakeClassList() };
    applyAuraBarSide(body, true);
    expect(body.classList.contains(AURA_BAR_BELOW_CLASS)).toBe(true);
  });

  it('removes it when the setting is off, independent of any prior state', () => {
    const body = { classList: new FakeClassList() };
    applyAuraBarSide(body, true);
    applyAuraBarSide(body, false);
    expect(body.classList.contains(AURA_BAR_BELOW_CLASS)).toBe(false);
  });
});
