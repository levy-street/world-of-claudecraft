import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPaladinBastionSweepClip,
  PALADIN_BASTION_SWEEP_CLIP,
  PALADIN_BASTION_SWEEP_DURATION,
  PALADIN_BASTION_SWEEP_IMPACT_TIME,
  PALADIN_BASTION_SWEEP_TIMES,
} from '../src/render/characters/paladin_bastion_sweep_clip';

const BONES = [
  'root',
  'hips',
  'spine',
  'chest',
  'head',
  'upperarmr',
  'lowerarmr',
  'upperarml',
  'lowerarml',
  'upperlegr',
  'lowerlegr',
  'upperlegl',
  'lowerlegl',
] as const;

function baseClip(): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const bone of BONES) {
    tracks.push(
      new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1.1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.VectorKeyframeTrack(`${bone}.position`, [0, 1.1], [0, 0, 0, 0, 0, 0]),
      new THREE.VectorKeyframeTrack(`${bone}.scale`, [0, 1.1], [1, 1, 1, 1, 1, 1]),
    );
  }
  return new THREE.AnimationClip('1H_Melee_Attack_Slice_Diagonal', 1.1, tracks);
}

function quaternionAt(clip: THREE.AnimationClip, bone: string, time: number): THREE.Quaternion {
  const track = clip.tracks.find((candidate) => candidate.name === `${bone}.quaternion`);
  if (!track) throw new Error(`missing ${bone}.quaternion`);
  const value = track.createInterpolant().evaluate(time);
  return new THREE.Quaternion(value[0], value[1], value[2], value[3]);
}

function angleDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  return THREE.MathUtils.radToDeg(a.angleTo(b));
}

describe('Paladin Bastion Sweep animation clip', () => {
  it('pins a 0.72 second shield sweep with impact at exactly 0.32 seconds', () => {
    const source = baseClip();
    const clip = createPaladinBastionSweepClip(source);

    expect(clip).not.toBe(source);
    expect(clip.name).toBe(PALADIN_BASTION_SWEEP_CLIP);
    expect(clip.duration).toBe(PALADIN_BASTION_SWEEP_DURATION);
    expect(PALADIN_BASTION_SWEEP_DURATION).toBe(0.72);
    expect(PALADIN_BASTION_SWEEP_IMPACT_TIME).toBe(0.32);
    expect([...PALADIN_BASTION_SWEEP_TIMES]).toEqual([
      0, 0.08, 0.16, 0.24, 0.32, 0.37, 0.48, 0.6, 0.72,
    ]);
    expect(clip.tracks.some((track) => track.name.endsWith('.scale'))).toBe(false);
  });

  it('uses the shield arm, torso, hips, legs, and counterbalancing weapon arm', () => {
    const clip = createPaladinBastionSweepClip(baseClip());
    const startHips = quaternionAt(clip, 'hips', 0);
    const windupHips = quaternionAt(clip, 'hips', 0.16);
    const impactHips = quaternionAt(clip, 'hips', PALADIN_BASTION_SWEEP_IMPACT_TIME);
    expect(angleDeg(startHips, windupHips)).toBeGreaterThan(20);
    expect(angleDeg(windupHips, impactHips)).toBeGreaterThan(45);

    const startShieldArm = quaternionAt(clip, 'upperarml', 0);
    const windupShieldArm = quaternionAt(clip, 'upperarml', 0.16);
    const impactShieldArm = quaternionAt(clip, 'upperarml', PALADIN_BASTION_SWEEP_IMPACT_TIME);
    expect(angleDeg(startShieldArm, windupShieldArm)).toBeGreaterThan(25);
    expect(angleDeg(windupShieldArm, impactShieldArm)).toBeGreaterThan(65);

    const weaponArmWindup = quaternionAt(clip, 'upperarmr', 0.16);
    const weaponArmImpact = quaternionAt(clip, 'upperarmr', PALADIN_BASTION_SWEEP_IMPACT_TIME);
    expect(angleDeg(weaponArmWindup, weaponArmImpact)).toBeGreaterThan(30);
  });

  it('holds the impact pose for 50 ms, follows through, and returns to idle', () => {
    const clip = createPaladinBastionSweepClip(baseClip());
    for (const track of clip.tracks) {
      const valueSize = track.getValueSize();
      for (let component = 0; component < valueSize; component++) {
        expect(track.values[4 * valueSize + component], track.name).toBeCloseTo(
          track.values[5 * valueSize + component],
          6,
        );
      }
    }
    expect(
      angleDeg(quaternionAt(clip, 'spine', 0.37), quaternionAt(clip, 'spine', 0.48)),
    ).toBeGreaterThan(8);
    for (const bone of BONES) {
      expect(
        angleDeg(quaternionAt(clip, bone, 0), quaternionAt(clip, bone, 0.72)),
        bone,
      ).toBeLessThan(0.01);
    }
  });

  it('keeps both feet planted with only a small hips step into the sweep', () => {
    const clip = createPaladinBastionSweepClip(baseClip());
    const root = clip.tracks.find((track) => track.name === 'root.position');
    const hips = clip.tracks.find((track) => track.name === 'hips.position');
    expect(root).toBeDefined();
    expect(hips).toBeDefined();
    expect(new Set(root?.values).size).toBe(1);
    const hipZ = Array.from(hips?.values ?? []).filter((_value, index) => index % 3 === 2);
    expect(Math.max(...hipZ) - Math.min(...hipZ)).toBeLessThanOrEqual(0.05);
    expect(Math.max(...hipZ) - Math.min(...hipZ)).toBeGreaterThan(0.02);
  });
});
