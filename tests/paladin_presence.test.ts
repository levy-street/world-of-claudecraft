import { describe, expect, it, vi } from 'vitest';
import {
  drivePaladinPresence,
  holdValkyrFlight,
  PaladinPresenceDriver,
  paladinSourcedAura,
} from '../src/render/paladin_presence';
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

  it('skips every body no Paladin touched, feeding each touched one a last frame after', () => {
    const f = fx();
    const driver = new PaladinPresenceDriver();
    const ward = { id: 'divine_protection', kind: 'absorb', remaining: 4, duration: 8, value: 50 };
    // An untouched body: no presence pass at all.
    expect(driver.drive(f, { ...idle, templateId: 'warrior' }, false, false)).toBeNull();
    expect(f.recallTheFallenListening).toHaveBeenCalledTimes(1);
    expect(f.wardOfFaithHold).not.toHaveBeenCalled();
    // Touched (a Paladin's ward on it): fed.
    driver.drive(f, { ...idle, templateId: 'warrior', auras: [ward] }, false, true);
    expect(f.wardOfFaithHold).toHaveBeenCalledTimes(1);
    // The ward goes: one more pass, so the held effects see it go, then none.
    const listened = f.recallTheFallenListening.mock.calls.length;
    driver.drive(f, { ...idle, templateId: 'warrior' }, false, false);
    expect(f.recallTheFallenListening.mock.calls.length).toBe(listened + 1);
    driver.drive(f, { ...idle, templateId: 'warrior' }, false, false);
    driver.drive(f, { ...idle, templateId: 'warrior' }, false, false);
    expect(f.recallTheFallenListening.mock.calls.length).toBe(listened + 3);
    expect(f.wardOfFaithHold).toHaveBeenCalledTimes(1);
    // A Paladin is always fed, touched or not (its own casts and flight).
    const flying = { ...idle, templateId: 'paladin', valkyrsCalling: { elapsed: 0.4 } };
    expect(driver.drive(f, flying, false, false)).toBe(0.4);
    // The Recall the Fallen death watch still hears an untouched body.
    const listening = fx(true);
    driver.drive(listening, { ...idle, id: 30, templateId: 'mage' }, true, false);
    expect(listening.recallTheFallenWatch).toHaveBeenCalledWith(30, true);
  });

  it('reads a Paladin touch off one aura: holy, or put there by a Paladin', () => {
    const entities = new Map([
      [1, { templateId: 'paladin' }],
      [2, { templateId: 'warrior' }],
    ]);
    expect(paladinSourcedAura({ school: 'holy', sourceId: 99 }, entities)).toBe(true);
    expect(paladinSourcedAura({ school: 'physical', sourceId: 1 }, entities)).toBe(true);
    expect(paladinSourcedAura({ school: 'physical', sourceId: 2 }, entities)).toBe(false);
    expect(paladinSourcedAura({ school: 'fire', sourceId: 99 }, entities)).toBe(false);
  });
});
