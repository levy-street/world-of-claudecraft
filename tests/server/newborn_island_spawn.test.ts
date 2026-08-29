// The auto-entered tutorial: a CREATED character's persisted row starts on
// the Proving Shore. The row is what decides an online spawn (Sim.addPlayer
// prefers savedPos over playerStart), so this single server-side fact is the
// whole entry mechanism: the offline Sim's default spawn and every parity
// golden stay untouched, and the greeting sweep sees the newborn already
// ashore and plays Odo's arrival instead of Bryn's ferry offer.

import { describe, expect, it } from 'vitest';
import { characterCreationTestSeam } from '../../server/main';
import { isOnProvingShore, PROVING_SHORE_ARRIVAL } from '../../src/sim/content/proving_shore';
import { PLAYER_START } from '../../src/sim/data';

describe('newborn island spawn (auto-entered tutorial)', () => {
  it('rolls every fresh character state at the Proving Shore arrival', () => {
    const state = characterCreationTestSeam.initialCharacterState('warrior', 'Newborn', 0);
    expect(state.pos).toEqual({ x: PROVING_SHORE_ARRIVAL.x, z: PROVING_SHORE_ARRIVAL.z });
    expect(state.facing).toBe(PROVING_SHORE_ARRIVAL.facing);
    expect(isOnProvingShore(state.pos.x, state.pos.z)).toBe(true);
  });

  it('leaves the offline default spawn in town (parity goldens depend on it)', () => {
    // The harbor-town rebuild (the New Eastbrook program) moved the authored
    // town spawn; the claim under test is only that it stays off the island.
    expect(PLAYER_START).toEqual({ x: -94, z: -58 });
    expect(isOnProvingShore(PLAYER_START.x, PLAYER_START.z)).toBe(false);
  });
});
