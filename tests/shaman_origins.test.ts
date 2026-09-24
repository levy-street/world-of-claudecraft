import { describe, expect, it, vi } from 'vitest';
import { sampleShamanOrigin, shamanOriginKind } from '../src/render/ability_vfx/shaman_origins';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

function fixture() {
  return {
    anchorOf: vi.fn((id: number, height: number, out: { x: number; y: number; z: number }) =>
      Object.assign(out, { x: id * 10, y: height * 2, z: 0 }),
    ),
    handPoint: vi.fn((_id: number, hand: 0 | 1, out: { x: number; y: number; z: number }) =>
      Object.assign(out, { x: 3 + hand, y: 0.8, z: 2 }),
    ),
    weaponPoint: vi.fn((_id: number, _hand: 0 | 1, out: { x: number; y: number; z: number }) => {
      Object.assign(out, { x: 5, y: 1, z: 2 });
      return true;
    }),
    isWeaponHand: () => true,
    groundYAt: vi.fn(() => -2),
    facingAt: () => 0,
  };
}

describe('authored Shaman origins', () => {
  it('classifies every shipped Shaman appearance without matching other classes', () => {
    for (const id of Object.keys(SHAMAN_VFX_FULL_SPECS))
      expect(shamanOriginKind(id), id).not.toBeNull();
    expect(shamanOriginKind('lightning_bolt')).toBe('hand');
    expect(shamanOriginKind('unleash_weapon_water')).toBe('weapon');
    expect(shamanOriginKind('earth_shock')).toBe('ground');
    expect(shamanOriginKind('stoneward')).toBe('ground');
    expect(shamanOriginKind('primal_exaltation_water')).toBe('body');
    expect(shamanOriginKind('fireball')).toBeNull();
  });

  it('uses the live hand instead of the body anchor and writes the supplied scratch', () => {
    const host = fixture(),
      out = { x: 0, y: 0, z: 0 };
    expect(sampleShamanOrigin(host, 'lightning_bolt', 7, out)).toBe(true);
    expect(out).toEqual({ x: 3, y: 0.8, z: 2 });
    expect(host.handPoint).toHaveBeenCalledWith(7, 0, out);
    expect(host.anchorOf).not.toHaveBeenCalled();
  });

  it('uses the current equipped tip for weapon releases and falls back to a real hand', () => {
    const host = fixture(),
      out = { x: 0, y: 0, z: 0 };
    expect(sampleShamanOrigin(host, 'unleash_weapon_fire', 7, out)).toBe(true);
    expect(out.x).toBe(5);
    expect(host.handPoint).not.toHaveBeenCalled();
    host.weaponPoint.mockReturnValue(false);
    expect(sampleShamanOrigin(host, 'stormstrike_earth', 7, out)).toBe(true);
    expect(out.x).toBe(3);
  });

  it('never treats an empty hand or shield as an equipped weapon', () => {
    const host = { ...fixture(), isWeaponHand: () => false },
      out = { x: 0, y: 0, z: 0 };
    sampleShamanOrigin(host, 'rockbiter_weapon', 7, out);
    expect(host.weaponPoint).not.toHaveBeenCalled();
    expect(out.x).toBe(3);
  });

  it('grounds earth releases to terrain, preserving the actor horizontal position', () => {
    const host = fixture(),
      out = { x: 0, y: 0, z: 0 };
    sampleShamanOrigin(host, 'earth_shock', 7, out);
    expect(out).toEqual({ x: 70, y: -1.96, z: 0 });
    expect(host.handPoint).not.toHaveBeenCalled();
  });

  it('samples a relay from the previous victim body, never their weapon or hand', () => {
    const host = fixture(),
      out = { x: 0, y: 0, z: 0 };
    sampleShamanOrigin(host, 'chain_lightning', 91, out, true);
    expect(out).toEqual({ x: 910, y: 1, z: 0 });
    expect(host.handPoint).not.toHaveBeenCalled();
    expect(host.weaponPoint).not.toHaveBeenCalled();
  });

  it('uses low outboard fallback rather than the face when hand bones are unavailable', () => {
    const host = { ...fixture(), handPoint: () => null },
      out = { x: 0, y: 0, z: 0 };
    sampleShamanOrigin(host, 'flame_shock', 7, out);
    expect(out).toEqual({ x: 70.42, y: 0.66, z: 0.18 });
    expect(host.anchorOf).toHaveBeenCalledWith(7, 0.33, out);
  });

  it('does not invent an origin for an absent actor or unknown ability', () => {
    const host = { ...fixture(), handPoint: () => null, anchorOf: () => null };
    expect(sampleShamanOrigin(host, 'chain_lightning', 7, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(sampleShamanOrigin(fixture(), 'fireball', 7, { x: 0, y: 0, z: 0 })).toBe(false);
  });
});
