// The occupied-slot tooltip's edit-gesture hints: src/ui/hud/action_bar/slot_edit_hints_core.ts.
import { describe, expect, it } from 'vitest';
import { slotEditHintLines } from '../src/ui/hud/action_bar/slot_edit_hints_core';
import { t } from '../src/ui/i18n';

describe('slotEditHintLines', () => {
  it('advertises the Shift-drag move first, then the Shift clear gestures, one sub-line each', () => {
    const html = slotEditHintLines();
    const move = t('abilityUi.actionBar.moveHint');
    const clear = t('abilityUi.actionBar.clearHint');
    expect(move).toBe('Shift-drag to move');
    expect(clear).toBe('Shift-right-click or Shift-Delete to clear');
    expect(html).toBe(`<div class="tt-sub">${move}</div><div class="tt-sub">${clear}</div>`);
  });
});
