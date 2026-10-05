import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { assetsReady } from '../../src/render/assets/preload';
import type { AnimState } from '../../src/render/characters/anim_state';
import * as assets from '../../src/render/characters/assets';
import { prepareVisual } from '../../src/render/characters/assets';
import {
  PALADIN_TEMPLARS_VERDICT_CLIP,
  PALADIN_TEMPLARS_VERDICT_DURATION,
  PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED,
  PALADIN_TEMPLARS_VERDICT_IMPACT_TIME,
} from '../../src/render/characters/paladin_templars_verdict_clip';
import { CharacterVisual } from '../../src/render/characters/visual';
import * as dressing from '../../src/render/characters/woc_armor_dressing';
import * as heads from '../../src/render/characters/woc_head_packs';
import { landWocFiles } from '../helpers/woc_streamed';

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
    // the composed paladin def is fetched on demand too (manifest.ts: out of the boot gate)
    await landWocFiles(assets, dressing, heads, [
      'player_paladin',
      'player_paladin_female',
      'player_paladin_modular',
    ]);
  }, 90_000);

  it('builds the separate clip against the real KayKit Paladin skeleton', () => {
    const prepared = prepareVisual('player_paladin_modular');
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

  it.each(['player_paladin', 'player_paladin_female'])(
    'keeps the authored WOC chop and solar effect on %s until the next attack',
    (key) => {
      const prepared = prepareVisual(key);
      const authored = prepared.clips.get('2H_Chop');
      expect(authored).toBeDefined();
      expect(prepared.def.clips.attackByAbility?.final_edict).toBe('2H_Chop');
      expect(prepared.clips.has(PALADIN_TEMPLARS_VERDICT_CLIP)).toBe(false);
      const visual = new CharacterVisual(key, 0xffffff);
      // An auto attack now uses the SAME authored chop. Ability ownership,
      // rather than clip identity alone, must clear the solar effect.
      visual.setWeapon('eastbrook_greatsword');
      visual.update(0, IDLE, true);
      // What the hands hold picks the chop's variant (weapon_loadout_core.ts: a two-hander plays
      // the two-hand set's chop); the authored ability clip is that variant of 2H_Chop.
      const swap = (visual as unknown as { loadoutSwap: Record<string, string> | null })
        .loadoutSwap;
      const played = prepared.clips.get(swap?.['2H_Chop'] || '2H_Chop');
      expect(played).toBeDefined();
      visual.playAttack('final_edict');
      // half way through the clip that PLAYS (the variant runs at its own length): the
      // effect's impact flash sits exactly there
      for (let frame = 0; frame < 5; frame++)
        visual.update((played?.duration ?? 0) * 0.1, IDLE, true);
      const action = (visual as unknown as { current: THREE.AnimationAction }).current;
      // the visual plays its own copy of the prepared clip (per-rig twins): same clip, by name
      expect(action.getClip().name).toBe(played?.name);

      const effect = visual.root.getObjectByName('paladinTemplarsVerdictFx');
      expect(effect).toBeDefined();
      expect(effect?.children.some((child) => child.visible)).toBe(true);
      const ancestors: string[] = [];
      for (let node = effect?.parent; node; node = node.parent) ancestors.push(node.name);
      expect(ancestors).toContain('handslotr');
      const impact = effect?.children.at(-1) as THREE.Mesh;
      expect((impact.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.82);

      visual.playAttack();
      visual.update(0.016, IDLE, true);
      expect((visual as unknown as { current: THREE.AnimationAction }).current.getClip().name).toBe(
        played?.name,
      );
      expect(effect?.children.every((child) => !child.visible)).toBe(true);
      visual.dispose();
    },
  );
});
