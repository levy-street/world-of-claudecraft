import { describe, expect, it } from 'vitest';
import { isPersistentEngineAura } from '../src/sim/persistent_aura';

describe('persistent class engine auras', () => {
  it('keeps rotation counters persistent without making timed buffs permanent', () => {
    for (const id of [
      'hunter_efficient_rhythm_progress',
      'hunter_efficient_rhythm_ready',
      'hunter_fang_chorus_counter',
      'hunter_overdraw_counter',
      'stampede_ready',
      'shaman_flow_state_progress',
      'shaman_flow_state_ready',
      'shaman_pyrebrand_mastery',
      'shaman_thunder_charges',
      'shaman_warspirit_cadence',
    ]) {
      expect(isPersistentEngineAura(id), id).toBe(true);
    }
    expect(isPersistentEngineAura('shaman_primal_exaltation')).toBe(false);
    expect(isPersistentEngineAura('hunter_apex_instinct')).toBe(false);
  });
});
