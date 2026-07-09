// Pure decision logic for the client hold-to-grab driver (src/game/yumi_grab.ts):
// which ready orb (if any) the local player should channel, and the mystery-aura
// "already holding" check. The stateful YumiGrabDriver edge-sends off this.

import { describe, expect, it } from 'vitest';
import { carriesMysteryPowerup, pickGrabbableOrb } from '../src/game/yumi_grab';

const orb = (id: number, x: number, z: number, state: 'ready' | 'spawning' = 'ready') => ({
  id,
  x,
  z,
  state,
  frac: 1,
});

const base = { x: 0, z: 0, holding: false, interactHeld: true, dead: false };

describe('pickGrabbableOrb', () => {
  it('picks the nearest READY orb within radius while Interact is held', () => {
    const orbs = [orb(1, 0.5, 0), orb(2, 2, 0)];
    expect(pickGrabbableOrb(base, orbs, 2.5)).toBe(1);
  });

  it('returns null when no orb is within reach', () => {
    expect(pickGrabbableOrb(base, [orb(1, 10, 0)], 2.5)).toBeNull();
  });

  it('ignores orbs still telegraphing (state !== ready)', () => {
    expect(pickGrabbableOrb(base, [orb(1, 0.5, 0, 'spawning')], 2.5)).toBeNull();
  });

  it('returns null when Interact is not held, the player is dead, or already holding', () => {
    const orbs = [orb(1, 0.5, 0)];
    expect(pickGrabbableOrb({ ...base, interactHeld: false }, orbs, 2.5)).toBeNull();
    expect(pickGrabbableOrb({ ...base, dead: true }, orbs, 2.5)).toBeNull();
    expect(pickGrabbableOrb({ ...base, holding: true }, orbs, 2.5)).toBeNull();
  });
});

describe('carriesMysteryPowerup', () => {
  it('is true for any pu_* aura, false otherwise', () => {
    expect(carriesMysteryPowerup([{ kind: 'pu_invuln' }])).toBe(true);
    expect(carriesMysteryPowerup([{ kind: 'pu_stealth' }])).toBe(true);
    expect(carriesMysteryPowerup([{ kind: 'buff_ap' }, { kind: 'dot' }])).toBe(false);
    expect(carriesMysteryPowerup([])).toBe(false);
  });
});
