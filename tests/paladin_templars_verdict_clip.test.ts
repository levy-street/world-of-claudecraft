import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPaladinTemplarsVerdictClip,
  PALADIN_TEMPLARS_VERDICT_CLIP,
  PALADIN_TEMPLARS_VERDICT_DURATION,
  PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED,
  PALADIN_TEMPLARS_VERDICT_IMPACT_TIME,
  PALADIN_TEMPLARS_VERDICT_TIMES,
} from '../src/render/characters/paladin_templars_verdict_clip';

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
      new THREE.QuaternionKeyframeTrack(
        `${bone}.quaternion`,
        [0, 1.6333333],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
      new THREE.VectorKeyframeTrack(`${bone}.position`, [0, 1.6333333], [0, 0, 0, 0, 0, 0]),
      new THREE.VectorKeyframeTrack(`${bone}.scale`, [0, 1.6333333], [1, 1, 1, 1, 1, 1]),
    );
  }
  return new THREE.AnimationClip('2H_Melee_Attack_Chop', 1.6333333, tracks);
}

function quaternionAt(clip: THREE.AnimationClip, bone: string, time: number): THREE.Quaternion {
  const track = clip.tracks.find((candidate) => candidate.name === `${bone}.quaternion`);
  if (!track) throw new Error(`missing ${bone} quaternion track`);
  const value = track.createInterpolant().evaluate(time);
  return new THREE.Quaternion(value[0], value[1], value[2], value[3]);
}

function angleDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  return THREE.MathUtils.radToDeg(a.angleTo(b));
}

describe('Paladin Templar Verdict animation clip', () => {
  it('bakes a separate 0.8 second quaternion clip with an exact impact contract', () => {
    const source = baseClip();
    const clip = createPaladinTemplarsVerdictClip(source);

    expect(clip).not.toBe(source);
    expect(clip.name).toBe(PALADIN_TEMPLARS_VERDICT_CLIP);
    expect(clip.duration).toBe(PALADIN_TEMPLARS_VERDICT_DURATION);
    expect(PALADIN_TEMPLARS_VERDICT_DURATION).toBe(0.8);
    expect(PALADIN_TEMPLARS_VERDICT_IMPACT_TIME).toBe(0.4);
    expect(PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED).toBe(0.5);
    expect([...PALADIN_TEMPLARS_VERDICT_TIMES]).toEqual([0, 0.1, 0.22, 0.31, 0.4, 0.47, 0.58, 0.8]);
    expect(clip.tracks.some((track) => track.name.endsWith('.scale'))).toBe(false);
    expect(source.tracks.some((track) => track.name.endsWith('.scale'))).toBe(true);
    for (const track of clip.tracks) {
      expect(track.times).toHaveLength(PALADIN_TEMPLARS_VERDICT_TIMES.length);
      for (let index = 0; index < track.times.length; index++) {
        expect(track.times[index]).toBeCloseTo(PALADIN_TEMPLARS_VERDICT_TIMES[index], 6);
      }
    }
  });

  it('uses hips, torso, both arms, head, and both legs for a committed full-body strike', () => {
    const clip = createPaladinTemplarsVerdictClip(baseClip());
    const trackNames = new Set(clip.tracks.map((track) => track.name));
    for (const bone of BONES) expect(trackNames.has(`${bone}.quaternion`), bone).toBe(true);

    const startHips = quaternionAt(clip, 'hips', 0);
    const anticipationHips = quaternionAt(clip, 'hips', 0.22);
    const impactHips = quaternionAt(clip, 'hips', PALADIN_TEMPLARS_VERDICT_IMPACT_TIME);
    expect(angleDeg(startHips, anticipationHips)).toBeGreaterThan(25);
    expect(angleDeg(anticipationHips, impactHips)).toBeGreaterThan(45);

    const startSpine = quaternionAt(clip, 'spine', 0);
    const anticipationSpine = quaternionAt(clip, 'spine', 0.22);
    const impactSpine = quaternionAt(clip, 'spine', PALADIN_TEMPLARS_VERDICT_IMPACT_TIME);
    expect(angleDeg(startSpine, anticipationSpine)).toBeGreaterThan(30);
    expect(angleDeg(anticipationSpine, impactSpine)).toBeGreaterThan(55);
  });

  it('holds impact for 70 ms, follows through, and recovers to the starting pose', () => {
    const clip = createPaladinTemplarsVerdictClip(baseClip());
    for (const track of clip.tracks) {
      const valueSize = track.getValueSize();
      for (let component = 0; component < valueSize; component++) {
        expect(track.values[4 * valueSize + component], track.name).toBeCloseTo(
          track.values[5 * valueSize + component],
          6,
        );
      }
    }
    for (const bone of ['hips', 'spine', 'chest', 'upperarmr', 'lowerarmr']) {
      const impact = quaternionAt(clip, bone, 0.4);
      const held = quaternionAt(clip, bone, 0.47);
      expect(angleDeg(impact, held), bone).toBeLessThan(0.05);
    }

    expect(
      angleDeg(quaternionAt(clip, 'spine', 0.47), quaternionAt(clip, 'spine', 0.58)),
    ).toBeGreaterThan(8);
    for (const bone of BONES) {
      expect(
        angleDeg(quaternionAt(clip, bone, 0), quaternionAt(clip, bone, 0.8)),
        bone,
      ).toBeLessThan(0.01);
    }
  });

  it('keeps root motion planted while allowing a small hips step into impact', () => {
    const clip = createPaladinTemplarsVerdictClip(baseClip());
    const root = clip.tracks.find((track) => track.name === 'root.position');
    const hips = clip.tracks.find((track) => track.name === 'hips.position');
    expect(root).toBeDefined();
    expect(hips).toBeDefined();
    expect(new Set(root?.values).size).toBe(1);
    const hipZ = Array.from(hips?.values ?? []).filter((_value, index) => index % 3 === 2);
    expect(Math.max(...hipZ) - Math.min(...hipZ)).toBeLessThanOrEqual(0.06);
    expect(Math.max(...hipZ) - Math.min(...hipZ)).toBeGreaterThan(0.03);
  });
});
