// The Pale Keeper's two-step revive copy: both the dialogue and the confirmation
// are worded for whether the Toll will actually land on a character of this level
// (a levelled hero never hears that a waiver exists; a newcomer is told they are
// spared).

import { describe, expect, it } from 'vitest';
import { RES_SICKNESS_MIN_LEVEL } from '../src/sim/resurrection';
import { t } from '../src/ui/i18n';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import {
  keeperReviveConfirm,
  keeperReviveDialogue,
  keeperTollSpared,
} from '../src/ui/keeper_revive_dialog_core';

describe('keeper_revive_dialog_core', () => {
  it('a levelled character hears the Toll and the free walk back, never the waiver', () => {
    for (const level of [RES_SICKNESS_MIN_LEVEL, 20, 60]) {
      const step = keeperReviveDialogue(level);
      expect(step.titleKey).toBe('hudChrome.death.keeperTalkTitle');
      const body = t(step.bodyKey);
      expect(body).toBe(hudChromeStrings.death.keeperTalkBody);
      expect(body).toMatch(/75%/);
      expect(body).toMatch(/no penalty/);
      expect(body).not.toMatch(/spare|new to this world|below level/i);
      expect(t(step.okKey)).toBe('Revive Me');
      expect(t(step.cancelKey)).toBe('Leave');
    }
  });

  it('a newcomer is told the Toll exists but that they are spared it', () => {
    for (const level of [1, RES_SICKNESS_MIN_LEVEL - 1]) {
      const step = keeperReviveDialogue(level);
      const body = t(step.bodyKey);
      expect(body).toBe(hudChromeStrings.death.keeperTalkSparedBody);
      expect(body).toMatch(/Toll/);
      expect(body).toMatch(/spare/);
      expect(body).toMatch(/new to this world/);
      expect(body).toMatch(/no penalty/);
    }
    expect(keeperTollSpared(RES_SICKNESS_MIN_LEVEL - 1)).toBe(true);
    expect(keeperTollSpared(RES_SICKNESS_MIN_LEVEL)).toBe(false);
  });

  it('at or above the floor the confirmation says the raise will weaken them', () => {
    for (const level of [RES_SICKNESS_MIN_LEVEL, RES_SICKNESS_MIN_LEVEL + 5, 60]) {
      const step = keeperReviveConfirm(level);
      expect(step.titleKey).toBe('hudChrome.death.healerConfirmTitle');
      expect(step.bodyKey).toBe('hudChrome.death.keeperConfirmBody');
      expect(t(step.bodyKey)).toMatch(/weaker/);
      expect(t(step.bodyKey)).toMatch(/75%/);
    }
  });

  it('below the floor the confirmation says the Toll will not touch them', () => {
    for (const level of [1, RES_SICKNESS_MIN_LEVEL - 1]) {
      const step = keeperReviveConfirm(level);
      expect(step.titleKey).toBe('hudChrome.death.keeperConfirmSparedTitle');
      expect(step.bodyKey).toBe('hudChrome.death.keeperConfirmSparedBody');
      expect(t(step.bodyKey)).toContain(`level ${RES_SICKNESS_MIN_LEVEL}`);
      expect(t(step.bodyKey)).not.toMatch(/75%/);
    }
  });

  it('both steps share the Revive Me / Cancel pair on the confirmation', () => {
    const step = keeperReviveConfirm(20);
    expect(t(step.okKey)).toBe('Revive Me');
    expect(t(step.cancelKey)).toBe('Cancel');
    expect(keeperReviveConfirm(20, 30).bodyKey).toBe('hudChrome.death.keeperConfirmSparedBody');
  });
});
