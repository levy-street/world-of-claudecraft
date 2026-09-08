import { expect, it, vi } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import type { Entity, SimEvent } from '../src/sim/types';
import { StudioCombatAudio } from '../src/vfx_studio/combat_audio';
import {
  isBloodlettingRecovery,
  WARRIOR_RECOVERY_SAMPLE,
  warriorRecoveryAudio,
} from '../src/warrior_recovery_core';

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
it('Studio plays one spatial recovery cue even without a preceding weapon hit', () => {
  const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
  const audio = new StudioCombatAudio(sink);
  const entities = new Map([[7, { id: 7, pos: { x: 4, y: 2, z: -3 } } as Entity]]);
  audio.event(heal(), entities, 7);
  expect(sink.playAt).toHaveBeenCalledExactlyOnceWith(WARRIOR_RECOVERY_SAMPLE, 4, 2, -3, {
    gain: 0.75,
    cooldown: 0.08,
  });
  audio.event(heal({ amount: 0, absorbed: 20 }), entities, 7);
  expect(sink.playAt).toHaveBeenCalledTimes(1);
  audio.event(heal({ ability: 'Unrelated Healing' }), entities, 7);
  expect(sink.playAt).toHaveBeenLastCalledWith('heal_impact', 4, 2, -3, {
    gain: 0.75,
    cooldown: 0.08,
  });
});
