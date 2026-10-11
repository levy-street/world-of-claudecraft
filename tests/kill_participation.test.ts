import { describe, expect, it } from 'vitest';
import { isKillParticipant, killParticipationPos } from '../src/sim/loot/kill_participation';
import { PARTY_XP_RANGE } from '../src/sim/types';

function ghost(corpseInstanceId: number | null) {
  return {
    ghost: true,
    corpsePos: { x: 5, y: 0, z: 5 },
    corpseInstanceId,
    pos: { x: 900, y: 0, z: 900 },
  } as any;
}

describe('kill participation leaf', () => {
  it('judges a released ghost from its corpse when the corpse is bound to the kill claim', () => {
    expect(killParticipationPos(ghost(7), 7)).toEqual({ x: 5, y: 0, z: 5 });
    expect(killParticipationPos(ghost(null), null)).toEqual({ x: 5, y: 0, z: 5 });
  });
  it('judges a ghost whose corpse lies in another claim from where it stands', () => {
    expect(killParticipationPos(ghost(3), 7)).toEqual({ x: 900, y: 0, z: 900 });
  });
  it('judges a living or unreleased member from where they stand, and no entity as nothing', () => {
    const live = {
      ghost: false,
      corpsePos: null,
      corpseInstanceId: null,
      pos: { x: 1, y: 0, z: 2 },
    };
    expect(killParticipationPos(live as any, 7)).toEqual({ x: 1, y: 0, z: 2 });
    expect(killParticipationPos(undefined, 7)).toBeNull();
  });
  it('keeps the classic party XP circle outside a claim', () => {
    const mob = { x: 0, y: 0, z: 0 };
    expect(isKillParticipant({ x: PARTY_XP_RANGE, y: 0, z: 0 }, mob, false)).toBe(true);
    expect(isKillParticipant({ x: PARTY_XP_RANGE + 1, y: 0, z: 0 }, mob, false)).toBe(false);
  });
  it('shares an instanced kill across the whole claim footprint', () => {
    expect(isKillParticipant({ x: 140, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, true)).toBe(true);
  });
});
