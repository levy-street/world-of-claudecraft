// src/render/characters/clip_twin.ts: the second clip object a re-triggered one-shot plays
// through, minted once per source clip and shared by every rig.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { twinClipOf } from '../src/render/characters/clip_twin';

function clip(name = 'Chop'): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('bone.position', [0, 1], [0, 0, 0, 10, 0, 0]),
  ]);
}

function rig() {
  const root = new THREE.Group();
  const bone = new THREE.Object3D();
  bone.name = 'bone';
  root.add(bone);
  return { root, bone, mixer: new THREE.AnimationMixer(root) };
}

describe('twinClipOf', () => {
  it('is another clip object holding the same animation under the same name', () => {
    const source = clip();
    const twin = twinClipOf(source);
    expect(twin).not.toBe(source);
    // the mixer keys an action on the clip's uuid: the twin must have its own
    expect(twin.uuid).not.toBe(source.uuid);
    expect(twin.name).toBe(source.name);
    expect(twin.duration).toBe(source.duration);
    expect(twin.blendMode).toBe(source.blendMode);
    expect(twin.tracks).toHaveLength(source.tracks.length);
    expect(twin.tracks[0].name).toBe(source.tracks[0].name);
    expect(Array.from(twin.tracks[0].times)).toEqual(Array.from(source.tracks[0].times));
    expect(Array.from(twin.tracks[0].values)).toEqual(Array.from(source.tracks[0].values));
  });

  it('mints one twin per source clip, however often it is asked', () => {
    const source = clip();
    const twin = twinClipOf(source);
    expect(twinClipOf(source)).toBe(twin);
    expect(twinClipOf(source)).toBe(twin);
    // another source, another twin
    expect(twinClipOf(clip())).not.toBe(twin);
  });

  it('gives one mixer two actions of the same animation, which the source alone cannot', () => {
    const { mixer } = rig();
    const source = clip();
    // the reason a twin exists: asking the mixer twice for one clip is one action
    expect(mixer.clipAction(source)).toBe(mixer.clipAction(source));
    const first = mixer.clipAction(source);
    const second = mixer.clipAction(twinClipOf(source));
    expect(second).not.toBe(first);
    expect(mixer.clipAction(twinClipOf(source))).toBe(second);
  });

  it('crossfades a clip into its own twin on one rig, and serves a second rig untouched', () => {
    const a = rig();
    const b = rig();
    const source = clip();
    const running = a.mixer.clipAction(source);
    running.play();
    a.mixer.update(0.5);
    expect(a.bone.position.x).toBeCloseTo(5, 5);
    // the re-trigger: the twin starts from the top while the running one fades out
    const twin = a.mixer.clipAction(twinClipOf(source));
    running.fadeOut(0.2);
    twin.reset().fadeIn(0.2).play();
    a.mixer.update(0.1);
    // halfway through the fade: an even blend of 0.6 s into the first and 0.1 s into the twin
    expect(running.time).toBeCloseTo(0.6, 5);
    expect(twin.time).toBeCloseTo(0.1, 5);
    expect(a.bone.position.x).toBeCloseTo(0.5 * 6 + 0.5 * 1, 4);
    // the same twin clip on another rig is that rig's own action, on its own clock
    const other = b.mixer.clipAction(twinClipOf(source));
    expect(other).not.toBe(twin);
    expect(other.getClip()).toBe(twin.getClip());
    other.play();
    b.mixer.update(0.3);
    expect(b.bone.position.x).toBeCloseTo(3, 5);
    expect(twin.time).toBeCloseTo(0.1, 5);
  });
});
