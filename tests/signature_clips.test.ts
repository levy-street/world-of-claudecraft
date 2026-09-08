import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSignatureClip,
  createSignatureHold,
  prepareSignatureClips,
  SIGNATURE_CONTACT_TIME,
  SIGNATURE_HOLD_POINT,
  signatureClipName,
} from '../src/render/characters/signature_clips';

describe('prepared signature gestures', () => {
  it('authors different joint poses with normalized rotations, planted roots and neutral recovery', () => {
    const base = new THREE.AnimationClip('Cast_Fire', 1, [
      ...['hips', 'chest', 'spine', 'upperarml', 'upperarmr'].map(
        (bone) =>
          new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      ),
      new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 1, 2, 3]),
      new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 1, 0, 0, 1, 0]),
    ]);
    const fire = createSignatureClip(base, 'pyroblast'),
      ice = createSignatureClip(base, 'frost_nova');
    expect(Array.from(fire.tracks[2].values)).not.toEqual(Array.from(ice.tracks[2].values));
    for (const track of fire.tracks.filter((t) => t.name.endsWith('quaternion'))) {
      for (let i = 0; i < track.values.length; i += 4)
        expect(Math.hypot(...track.values.slice(i, i + 4))).toBeCloseTo(1);
      expect(Array.from(track.values.slice(-4))).toEqual([0, 0, 0, 1]);
    }
    expect(Array.from(fire.tracks[5].values).every((v) => v === 0)).toBe(true);
    expect(Array.from(base.tracks[5].values)).toEqual([0, 0, 0, 1, 2, 3]);
    const hold = createSignatureHold(base, 'pyroblast');
    expect(hold.tracks[0].times[3]).toBeCloseTo(SIGNATURE_HOLD_POINT);
    expect(Array.from(hold.tracks[2].values.slice(-8, -4))).toEqual(
      Array.from(hold.tracks[2].values.slice(-4)),
    );
  });
  const source = () =>
    new THREE.AnimationClip('Cast', 1, [
      new THREE.NumberKeyframeTrack('root.position[x]', [0, 0.5, 1], [0, 1, 0]),
    ]);
  it('preserves source tracks and authors a contact hold with recovery', () => {
    const base = source(),
      original = Array.from(base.tracks[0].values),
      clip = createSignatureClip(base, 'pyroblast');
    expect(clip.name).toBe(signatureClipName('pyroblast'));
    expect(clip.duration).toBe(0.68);
    expect(clip.tracks[0].times[3]).toBeCloseTo(SIGNATURE_CONTACT_TIME);
    expect(clip.tracks[0].values[3]).toBe(clip.tracks[0].values[4]);
    expect(clip.tracks[0].values.at(-1)).toBe(0);
    expect(Array.from(base.tracks[0].values)).toEqual(original);
    expect(clip.tracks[0]).not.toBe(base.tracks[0]);
  });
  it('builds safe source aliases and leaves unsupported creature rigs alone', () => {
    const clips = new Map([['Cast', source()]]);
    prepareSignatureClips(clips, { lightning_bolt: 'Cast' });
    expect(clips.has(signatureClipName('chain_lightning'))).toBe(true);
    const creature = new Map([['Cast', source()]]);
    prepareSignatureClips(creature, undefined);
    expect(creature.size).toBe(1);
  });
  it.each([
    ['Cast_Fire', 0.4],
    ['Cast_Nova', 0.85],
    ['Cast_Bolt', 1.1],
    ['Cast_Heal', 0.7],
    ['Cast_Verdict', 0.6],
    ['Warlock_Cast_Shadow', 0.6],
    ['2H_Melee_Attack_Chop', 1],
    ['Spellcast_Raise', 1.8],
  ] as const)('samples the authored %s contact pose', (name, contact) => {
    const base = new THREE.AnimationClip(name, 2, [
      new THREE.NumberKeyframeTrack('root.position[x]', [0, 2], [0, 2]),
    ]);
    const clip = createSignatureClip(base, 'execute');
    expect(clip.tracks[0].values[3]).toBeCloseTo(contact);
    expect(clip.tracks[0].values[4]).toBeCloseTo(contact);
  });
  it('prepares the paladin signature from its loaded smite clip', () => {
    const base = source();
    base.name = 'Cast_Verdict';
    const clips = new Map([['Cast_Verdict', base]]);
    prepareSignatureClips(clips, { final_edict: 'Paladin_Templars_Verdict_1H' });
    expect(clips.has(signatureClipName('hammer_of_wrath'))).toBe(true);
  });
});
