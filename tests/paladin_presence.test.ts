import { describe, expect, it, vi } from 'vitest';
import { drivePaladinPresence, holdValkyrFlight } from '../src/render/paladin_presence';
import {
  VALKYR_LAND,
  VALKYR_RETURN,
  VALKYR_VANISH,
} from '../src/render/paladin_valkyrs_calling_core';

function fx(listening = false) {
  return {
    recallTheFallenChannel: vi.fn(),
    mendingLightChannel: vi.fn(),
    recallTheFallenListening: vi.fn(() => listening),
    recallTheFallenWatch: vi.fn(),
    solarStepSprint: vi.fn(),
    hushbrandHold: vi.fn(),
    wardOfFaithHold: vi.fn(),
    sunderingGavelHold: vi.fn(),
  };
}
const idle = {
  id: 7,
  dead: false,
  castingAbility: null,
  castRemaining: 0,
  castTotal: 0,
  castTargetId: null,
  auras: [],
};

describe('Paladin presence', () => {
  it('feeds the Recall the Fallen rite from the live cast, and reports deaths while listening', () => {
    const f = fx(true);
    drivePaladinPresence(
      f,
      {
        ...idle,
        castingAbility: 'recall_the_fallen',
        castTotal: 8,
        castRemaining: 2,
        castTargetId: 9,
      },
      false,
    );
    expect(f.recallTheFallenChannel).toHaveBeenCalledExactlyOnceWith(7, 9, 0.75);
    expect(f.recallTheFallenWatch).toHaveBeenCalledExactlyOnceWith(7, false);
    const quiet = fx(false);
    drivePaladinPresence(quiet, idle, true);
    expect(quiet.recallTheFallenWatch).not.toHaveBeenCalled();
  });

  it('feeds Mending Light from the live cast', () => {
    const f = fx();
    drivePaladinPresence(
      f,
      {
        ...idle,
        castingAbility: 'holy_light',
        castTotal: 1.5,
        castRemaining: 0.5,
        castTargetId: 9,
      },
      false,
    );
    expect(f.mendingLightChannel).toHaveBeenCalledOnce();
    expect(f.mendingLightChannel.mock.calls[0][0]).toBe(7);
    expect(f.mendingLightChannel.mock.calls[0][1]).toBeCloseTo(2 / 3);
  });

  it('holds Solar Step (with Steadfast Step), the Hushbrand lockout and Ward of Faith, never on the dead', () => {
    const f = fx();
    const auras = [
      { id: 'divine_protection', kind: 'absorb', remaining: 6, duration: 10, value: 80 },
      { id: 'hammer_of_justice_stun', kind: 'stun', remaining: 2, duration: 3 },
      { id: 'solar_step', kind: 'buff_speed', remaining: 1, duration: 2 },
      { id: 'solar_step_slow_immunity', kind: 'slow_immunity', remaining: 1, duration: 2 },
      { id: 'hushbrand_lockout', kind: 'lockout', remaining: 1, duration: 4 },
    ];
    expect(drivePaladinPresence(f, { ...idle, auras }, false)).toBeNull();
    expect(f.solarStepSprint).toHaveBeenCalledExactlyOnceWith(7, true);
    expect(f.hushbrandHold).toHaveBeenCalledExactlyOnceWith(7, 0.25);
    expect(f.wardOfFaithHold).toHaveBeenCalledExactlyOnceWith(7, 80, 6);
    expect(f.sunderingGavelHold).toHaveBeenCalledExactlyOnceWith(7);
    const dead = fx();
    drivePaladinPresence(dead, { ...idle, dead: true, auras }, true);
    expect(dead.solarStepSprint).not.toHaveBeenCalled();
    expect(dead.hushbrandHold).not.toHaveBeenCalled();
    expect(dead.wardOfFaithHold).not.toHaveBeenCalled();
    expect(dead.sunderingGavelHold).not.toHaveBeenCalled();
  });

  it('returns the Valkyr flight clock and hides the body only while it is gone', () => {
    expect(drivePaladinPresence(fx(), { ...idle, valkyrsCalling: { elapsed: 0.8 } }, false)).toBe(
      0.8,
    );
    const body = { root: { visible: true }, setValkyrFlight: vi.fn() };
    holdValkyrFlight(body, VALKYR_VANISH + 0.1);
    expect(body.root.visible).toBe(false);
    expect(body.setValkyrFlight).toHaveBeenCalledWith(VALKYR_VANISH + 0.1, VALKYR_LAND);
    body.root.visible = true;
    holdValkyrFlight(body, VALKYR_RETURN);
    expect(body.root.visible).toBe(true);
  });
});
