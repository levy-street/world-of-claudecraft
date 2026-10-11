// Behavioral pins for the aura-row placement settings (replaces a source-text
// scan on main.ts, which has no lightweight instantiation seam of its own). A
// hand-rolled fake classList, the repo's convention for DOM-shaped units that
// don't need a full jsdom/happy-dom environment (see tests/movable_frame.test.ts).
import { describe, expect, it } from 'vitest';
import {
  AURA_BAR_BELOW_CLASS,
  applyAuraBarDirection,
  applyAuraBarSide,
  TARGET_AURAS_BELOW_CLASS,
} from '../src/ui/aura_bar_side';

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
    applyAuraBarSide(body, 'auraBarBelowFrame', true);
    expect(body.classList.contains(AURA_BAR_BELOW_CLASS)).toBe(true);
  });

  it('removes it when the setting is off, independent of any prior state', () => {
    const body = { classList: new FakeClassList() };
    applyAuraBarSide(body, 'auraBarBelowFrame', true);
    applyAuraBarSide(body, 'auraBarBelowFrame', false);
    expect(body.classList.contains(AURA_BAR_BELOW_CLASS)).toBe(false);
  });

  // The target strip (#tf-debuffs) flipped above the frame when the stock
  // target seat moved over the action bar (v0.44.0); players who move the
  // frame elsewhere get the classic below-frame layout back through their own
  // setting, keyed on a distinct class so the two frames never share a flip.
  it('toggles the target strip class on its own, leaving the player class alone', () => {
    const body = { classList: new FakeClassList() };
    applyAuraBarSide(body, 'targetAurasBelowFrame', true);
    expect(body.classList.contains(TARGET_AURAS_BELOW_CLASS)).toBe(true);
    expect(body.classList.contains(AURA_BAR_BELOW_CLASS)).toBe(false);
    applyAuraBarSide(body, 'targetAurasBelowFrame', false);
    expect(body.classList.contains(TARGET_AURAS_BELOW_CLASS)).toBe(false);
  });

  it('uses two distinct body classes', () => {
    expect(TARGET_AURAS_BELOW_CLASS).not.toBe(AURA_BAR_BELOW_CLASS);
  });
});

describe('applyAuraBarDirection', () => {
  const fakeRoot = () => {
    const vars = new Map<string, string>();
    return {
      vars,
      style: {
        setProperty(name: string, value: string) {
          vars.set(name, value);
        },
      },
    };
  };

  it('writes row / row-reverse to the per-row CSS var', () => {
    const root = fakeRoot();
    applyAuraBarDirection(root, 'buffsLeftToRight', true);
    expect(root.vars.get('--buff-bar-direction')).toBe('row');
    applyAuraBarDirection(root, 'buffsLeftToRight', false);
    expect(root.vars.get('--buff-bar-direction')).toBe('row-reverse');
  });

  it('keeps the debuff row on its own var', () => {
    const root = fakeRoot();
    applyAuraBarDirection(root, 'debuffsLeftToRight', true);
    expect(root.vars.get('--debuff-bar-direction')).toBe('row');
    expect(root.vars.has('--buff-bar-direction')).toBe(false);
  });
});
