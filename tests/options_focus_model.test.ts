import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MENU_BUTTON_INTENTS } from '../src/game/menu_gamepad_nav';
import {
  clampIndex,
  FOCUS_INTENTS,
  type FocusIntent,
  type RowControlKind,
  rowKeyIntent,
  SLIDER_PAGE_STEPS,
  segIndexForIntent,
  sliderStepValue,
  wrapIndex,
} from '../src/ui/options_focus_model';

// options_focus_model is a PURE core (no DOM, no navigator, deterministic): it is the
// single place keyboard AND controller converge. It maps a focused row's key press, or a
// controller menu verb, to ONE shared FocusIntent, and owns the value/index math the thin
// painter applies. There is no IWorld, so the Sim/ClientWorld parity row is N/A (like
// roving_index / menu_gamepad_nav); the contract is same-input-same-output.

describe('options_focus_model: the FocusIntent set is a superset of the controller verbs', () => {
  it('covers every controller menu verb (keyboard + controller converge here)', () => {
    const focus = new Set<string>(FOCUS_INTENTS);
    // Every button->intent verb the pad emits must be a FocusIntent the painter can apply,
    // so handleMenuIntent(intent) type-checks and cannot silently drop a verb.
    for (const verb of Object.values(MENU_BUTTON_INTENTS)) {
      expect(focus.has(verb as string), `controller verb '${verb}' is a FocusIntent`).toBe(true);
    }
  });

  it('lists each intent exactly once and adds the keyboard-only slider/segment extras', () => {
    // No duplicates.
    expect(new Set(FOCUS_INTENTS).size).toBe(FOCUS_INTENTS.length);
    // The keyboard-only members the controller verb set does not carry (slider page +
    // segment first/last edges).
    for (const extra of ['adjustMin', 'adjustMax', 'adjustPageDec', 'adjustPageInc'] as const) {
      expect(FOCUS_INTENTS).toContain(extra);
    }
  });
});

describe('options_focus_model: rowKeyIntent per control kind (both directions)', () => {
  it('switch: Left = decrease (off), Right = increase (on); nothing else', () => {
    expect(rowKeyIntent('switch', 'ArrowLeft')).toBe('adjustDec');
    expect(rowKeyIntent('switch', 'ArrowRight')).toBe('adjustInc');
    // Space/Enter are the native toggle; the model leaves them to the button.
    for (const k of ['ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Enter', 'PageUp']) {
      expect(rowKeyIntent('switch', k), `switch/${k}`).toBeNull();
    }
  });

  it('segmented: Left/Right rove, Home/End jump to first/last, verticals ignored', () => {
    expect(rowKeyIntent('segmented', 'ArrowLeft')).toBe('adjustDec');
    expect(rowKeyIntent('segmented', 'ArrowRight')).toBe('adjustInc');
    expect(rowKeyIntent('segmented', 'Home')).toBe('adjustMin');
    expect(rowKeyIntent('segmented', 'End')).toBe('adjustMax');
    for (const k of ['ArrowUp', 'ArrowDown', 'Enter', ' ']) {
      expect(rowKeyIntent('segmented', k), `segmented/${k}`).toBeNull();
    }
  });

  it('slider: only Page keys are owned (Left/Right/Home/End stay native to the range input)', () => {
    expect(rowKeyIntent('slider', 'PageUp')).toBe('adjustPageInc');
    expect(rowKeyIntent('slider', 'PageDown')).toBe('adjustPageDec');
    for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown']) {
      expect(rowKeyIntent('slider', k), `slider/${k}`).toBeNull();
    }
  });

  it('keybind + other kinds own no value key', () => {
    for (const control of ['keybind', 'other'] as RowControlKind[]) {
      for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'Enter', ' ']) {
        expect(rowKeyIntent(control, k), `${control}/${k}`).toBeNull();
      }
    }
  });
});

describe('options_focus_model: sliderStepValue (bounds pinned, both directions)', () => {
  it('steps one step up and down and rounds nothing', () => {
    expect(sliderStepValue(0.5, 0, 1, 0.05, 1)).toBeCloseTo(0.55, 10);
    expect(sliderStepValue(0.5, 0, 1, 0.05, -1)).toBeCloseTo(0.45, 10);
  });

  it('clamps at the max going up and the min going down', () => {
    expect(sliderStepValue(1, 0, 1, 0.05, 1)).toBe(1); // already at max
    expect(sliderStepValue(0.98, 0, 1, 0.05, 1)).toBe(1); // would overshoot -> clamp
    expect(sliderStepValue(0, 0, 1, 0.05, -1)).toBe(0); // already at min
    expect(sliderStepValue(0.02, 0, 1, 0.05, -1)).toBe(0); // would undershoot -> clamp
  });

  it('a page jump moves SLIDER_PAGE_STEPS steps and still clamps', () => {
    expect(SLIDER_PAGE_STEPS).toBe(10);
    expect(sliderStepValue(0.2, 0, 1, 0.05, 1, SLIDER_PAGE_STEPS)).toBeCloseTo(0.7, 10);
    expect(sliderStepValue(0.2, 0, 1, 0.05, -1, SLIDER_PAGE_STEPS)).toBe(0); // 0.2 - 0.5 -> clamp 0
    expect(sliderStepValue(0.8, 0, 1, 0.05, 1, SLIDER_PAGE_STEPS)).toBe(1); // 0.8 + 0.5 -> clamp 1
  });

  it('honors a non-zero min and a degrees-style integer step', () => {
    expect(sliderStepValue(60, 30, 110, 1, 1)).toBe(61);
    expect(sliderStepValue(30, 30, 110, 1, -1)).toBe(30); // clamp at min 30
    expect(sliderStepValue(110, 30, 110, 1, 1)).toBe(110); // clamp at max 110
  });
});

describe('options_focus_model: index math', () => {
  it('wrapIndex cycles categories with wraparound in both directions', () => {
    expect(wrapIndex(4, 0, 1)).toBe(1);
    expect(wrapIndex(4, 3, 1)).toBe(0); // wrap forward off the end
    expect(wrapIndex(4, 0, -1)).toBe(3); // wrap back off the start
    expect(wrapIndex(4, 2, -1)).toBe(1);
    expect(wrapIndex(0, 0, 1)).toBe(0); // empty -> unchanged
  });

  it('clampIndex moves row focus without wrapping and stops at the ends', () => {
    expect(clampIndex(4, 0, 1)).toBe(1);
    expect(clampIndex(4, 3, 1)).toBe(3); // last, down -> stay
    expect(clampIndex(4, 0, -1)).toBe(0); // first, up -> stay
    expect(clampIndex(4, 2, -1)).toBe(1);
    expect(clampIndex(0, 0, 1)).toBe(-1); // no rows -> no focus
  });

  it('segIndexForIntent roves with wrap, jumps to first/last, and ignores non-adjust intents', () => {
    expect(segIndexForIntent(3, 0, 'adjustInc')).toBe(1);
    expect(segIndexForIntent(3, 2, 'adjustInc')).toBe(0); // wrap forward
    expect(segIndexForIntent(3, 0, 'adjustDec')).toBe(2); // wrap back
    expect(segIndexForIntent(3, 1, 'adjustMin')).toBe(0);
    expect(segIndexForIntent(3, 1, 'adjustMax')).toBe(2);
    for (const intent of ['activate', 'back', 'rowNext', 'pageUp'] as FocusIntent[]) {
      expect(segIndexForIntent(3, 1, intent), intent).toBeNull();
    }
    expect(segIndexForIntent(0, 0, 'adjustInc')).toBeNull(); // no options
  });
});

describe('options_focus_model: purity (no magic values, no DOM)', () => {
  it('carries no hex color or px literal (named constants only)', () => {
    const src = readFileSync(new URL('../src/ui/options_focus_model.ts', import.meta.url), 'utf8');
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(src, 'no px literal').not.toMatch(/\b\d+px\b/);
  });
});
