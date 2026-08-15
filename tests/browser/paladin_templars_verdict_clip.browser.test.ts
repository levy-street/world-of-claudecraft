import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { assetsReady } from '../../src/render/assets/preload';
import type { AnimState } from '../../src/render/characters/anim_state';
import { prepareVisual } from '../../src/render/characters/assets';
import {
  PALADIN_TEMPLARS_VERDICT_CLIP,
  PALADIN_TEMPLARS_VERDICT_DURATION,
  PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED,
  PALADIN_TEMPLARS_VERDICT_IMPACT_TIME,
} from '../../src/render/characters/paladin_templars_verdict_clip';
import { CharacterVisual } from '../../src/render/characters/visual';

const IDLE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

describe('Paladin Templar Verdict baked asset', () => {
  beforeAll(async () => {
    await assetsReady();
  }, 30_000);

  it('builds the separate clip against the real KayKit Paladin skeleton', () => {
    const prepared = prepareVisual('player_paladin');
    const clip = prepared.clips.get(PALADIN_TEMPLARS_VERDICT_CLIP);

    expect(clip).toBeDefined();
    expect(clip?.name).toBe(PALADIN_TEMPLARS_VERDICT_CLIP);
    expect(clip?.duration).toBe(PALADIN_TEMPLARS_VERDICT_DURATION);
    expect(PALADIN_TEMPLARS_VERDICT_IMPACT_TIME).toBe(0.4);
    expect(PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED).toBe(0.5);
    expect(clip?.tracks.some((track) => track.name.endsWith('.scale'))).toBe(false);

    const trackNames = new Set(clip?.tracks.map((track) => track.name));
    for (const bone of [
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
    ]) {
      expect(trackNames.has(`${bone}.quaternion`), bone).toBe(true);
    }

    const quaternionAt = (bone: string, time: number): THREE.Quaternion => {
      const track = clip?.tracks.find((candidate) => candidate.name === `${bone}.quaternion`);
      if (!track) throw new Error(`missing ${bone}.quaternion`);
      const value = track.createInterpolant().evaluate(time);
      return new THREE.Quaternion(value[0], value[1], value[2], value[3]);
    };
    const angle = (bone: string, from: number, to: number): number =>
      THREE.MathUtils.radToDeg(quaternionAt(bone, from).angleTo(quaternionAt(bone, to)));
    expect(angle('upperarmr', 0, 0.22)).toBeGreaterThan(30);
    expect(angle('upperarmr', 0.22, 0.4)).toBeGreaterThan(70);
    expect(angle('upperarmr', 0.47, 0.58)).toBeGreaterThan(8);
  });

  it('shows the solar weapon effect only while Final Edict owns the one-shot', () => {
    const visual = new CharacterVisual('player_paladin', 0xffffff);
    visual.update(0, IDLE, true);
    visual.playAttack('final_edict');
    visual.update(0.31, IDLE, true);

    const effect = visual.root.getObjectByName('paladinTemplarsVerdictFx');
    expect(effect).toBeDefined();
    expect(effect?.children.some((child) => child.visible)).toBe(true);

    visual.playAttack();
    visual.update(0.016, IDLE, true);
    expect(effect?.children.every((child) => !child.visible)).toBe(true);
    visual.dispose();
  });
});
