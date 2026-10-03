// The Sunken Bastion's creature effects plan (src/render/sunken_bastion/
// bastion_creature_fx_core.ts): the arbalest's bolt looses from its crossbow
// (in front of it, at shoulder height, off its right side), flies the
// Piercing Bolt's whole lane, and the Turnkey's lantern flares high over it.
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  ARBALEST,
  ARBALEST_MUZZLE,
  ARBALEST_RAW_HEIGHT,
  boltFlightSeconds,
  boltTrailLength,
  LANTERN_FLARE_SEC,
  lanternFlareEnvelope,
  modelPointWorld,
  modelScale,
  piercingBoltReach,
  RUSTED_BOLT_SPEED,
  TURNKEY,
  TURNKEY_LANTERN_HIGH,
  TURNKEY_RAW_HEIGHT,
} from '../src/render/sunken_bastion/bastion_creature_fx_core';
import { MOBS } from '../src/sim/data';

const out = () => ({ x: 0, y: 0, z: 0 });

describe('the Bastion creature effects plan', () => {
  it('looses the bolt ahead of the arbalest, at its shoulder, off its right side', () => {
    const k = modelScale(
      VISUALS.bastion_skel_arbalest.height,
      MOBS[ARBALEST].scale ?? 1,
      ARBALEST_RAW_HEIGHT,
    );
    const height = VISUALS.bastion_skel_arbalest.height * (MOBS[ARBALEST].scale ?? 1);
    // Facing +z (yaw 0): forward is +z, the creature's right is -x.
    const m = modelPointWorld(10, 2, 20, 0, k, ARBALEST_MUZZLE, out());
    expect(m.z).toBeGreaterThan(20 + 2);
    expect(m.x).toBeLessThan(10);
    expect(m.y - 2).toBeGreaterThan(height * 0.5);
    expect(m.y - 2).toBeLessThan(height * 0.8);
    // Turned to face +x (yaw pi/2), forward follows.
    const t = modelPointWorld(0, 0, 0, Math.PI / 2, k, ARBALEST_MUZZLE, out());
    expect(t.x).toBeGreaterThan(2);
    expect(Math.abs(t.z)).toBeLessThan(t.x);
  });

  it('flies fast and never zero, and the Piercing Bolt covers the lane the sim tests', () => {
    expect(boltFlightSeconds(24, RUSTED_BOLT_SPEED)).toBeCloseTo(0.5, 5);
    expect(boltFlightSeconds(0, RUSTED_BOLT_SPEED)).toBeGreaterThan(0);
    expect(piercingBoltReach()).toBe(MOBS[ARBALEST].trashKit?.line?.length);
    expect(boltTrailLength(1, 3.4)).toBe(1);
    expect(boltTrailLength(10, 3.4)).toBe(3.4);
  });

  it('flares the lantern high over the Turnkey, swelling fast and fading out', () => {
    const k = modelScale(
      VISUALS.bastion_turnkey.height,
      MOBS[TURNKEY].scale ?? 1,
      TURNKEY_RAW_HEIGHT,
    );
    const height = VISUALS.bastion_turnkey.height * (MOBS[TURNKEY].scale ?? 1);
    const p = modelPointWorld(0, 0, 0, 0, k, TURNKEY_LANTERN_HIGH, out());
    expect(p.y).toBeGreaterThan(height * 0.8);
    expect(lanternFlareEnvelope(-0.1)).toBe(0);
    expect(lanternFlareEnvelope(0.3)).toBeCloseTo(1, 5);
    expect(lanternFlareEnvelope(LANTERN_FLARE_SEC * 0.8)).toBeLessThan(0.5);
    expect(lanternFlareEnvelope(LANTERN_FLARE_SEC + 0.01)).toBe(0);
  });
});
