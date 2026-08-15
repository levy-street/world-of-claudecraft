// Determinism + coverage guard for the pure block combat-log key selector
// (block_landing_feedback_core.ts), the sibling of heal_landing_feedback_core.ts for the
// block half of hud.ts's damage-event switch. Pins the distinct combat-log sentence a
// shield block gets on both sides of the swing, plus the no-log null case.

import { describe, expect, it } from 'vitest';
import { blockLandingLogKey } from '../src/ui/block_landing_feedback_core';

describe('blockLandingLogKey: the distinct combat-log line for a landed shield block', () => {
  it('the player dealing a blocked hit gets the blockedDone sentence, not the plain damageDone one', () => {
    expect(blockLandingLogKey(true, false)).toBe('hud.combat.blockedDone');
  });

  it('the player taking a blocked hit gets the blockedTaken sentence, not the plain damageTaken one', () => {
    expect(blockLandingLogKey(false, true)).toBe('hud.combat.blockedTaken');
  });

  it('a self-inflicted block reads as blockedTaken, matching the FCT shape priority (isPlayerTarget wins)', () => {
    expect(blockLandingLogKey(true, true)).toBe('hud.combat.blockedTaken');
  });

  it('a block between two non-player entities logs nothing', () => {
    expect(blockLandingLogKey(false, false)).toBeNull();
  });
});
