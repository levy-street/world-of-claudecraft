import { expect, it } from 'vitest';
import {
  isBloodlettingRecovery,
  WARRIOR_RECOVERY_SAMPLE,
  warriorRecoveryAudio,
} from '../src/game/warrior_recovery_core';
import { ABILITIES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { healAudioPlan } from '../src/ui/combat_sfx';

const heal = (
  extra: Partial<Extract<SimEvent, { type: 'heal2' }>> = {},
): Extract<SimEvent, { type: 'heal2' }> => ({
  type: 'heal2',
  sourceId: 7,
  targetId: 7,
  ability: ABILITIES.bloodthirst.name,
  amount: 20,
  crit: false,
  ...extra,
});
it('recognizes the real self-heal name and gives explicit ability identity precedence', () => {
  expect(isBloodlettingRecovery(heal())).toBe(true);
  expect(isBloodlettingRecovery(heal({ ability: 'localized', abilityId: 'bloodthirst' }))).toBe(
    true,
  );
  for (const extra of [
    { targetId: 8 },
    { ability: 'Bloodletting echo' },
    { abilityId: 'victory_rush' },
    { cueOnly: true },
  ])
    expect(isBloodlettingRecovery(heal(extra))).toBe(false);
});
it('sounds only effective health restoration and does not consume unrelated heals', () => {
  expect(warriorRecoveryAudio(heal())).toBe(WARRIOR_RECOVERY_SAMPLE);
  for (const amount of [0, -1, NaN, Infinity])
    expect(warriorRecoveryAudio(heal({ amount }))).toBeNull();
  expect(warriorRecoveryAudio(heal({ abilityId: 'victory_rush' }))).toBeUndefined();
});
it('the combat consumer selects recovery without a weapon hit and retains unrelated healing', () => {
  expect(healAudioPlan(heal())).toEqual({ cue: WARRIOR_RECOVERY_SAMPLE, gain: 0.75 });
  expect(healAudioPlan(heal({ amount: 0, absorbed: 20 }))).toBeNull();
  expect(healAudioPlan(heal({ ability: 'Unrelated Healing' }))).toEqual({
    cue: 'heal_impact',
    gain: 1,
  });
});
